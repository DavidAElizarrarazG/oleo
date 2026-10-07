// Báscula IoT (sección 12): simulador realista de un HX711 y cliente Web Bluetooth.
// Ambas clases emiten el evento 'lectura' con { raw, kg, stable, ntu, fuente }.

export const OFFSET = 84213;   // cuentas con la plataforma vacía
export const FACTOR = 21450;   // cuentas por kg (calibración)
const HZ = 10;
const RUIDO_CUENTAS = 120;     // desviación estándar del ruido (unos ±6 g)
const VENTANA_ESTABLE = 10;    // lecturas
const UMBRAL_ESTABLE = 0.02;   // kg

const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
function normal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const uniforme = (a, b) => a + Math.random() * (b - a);

export class BasculaSimulada extends EventTarget {
  constructor({ tara = 1.2, densidad = 0.91 } = {}) {
    super();
    this.tara = tara;
    this.densidad = densidad;
    this.fuente = 'simulada';
    this.kgDesde = 0;
    this.kgObjetivo = 0;
    this.t0 = 0;
    this.ntuBase = null;
    this.timer = null;
    this.crudos = [];
    this.filtrado = null;   // media móvil exponencial de las cuentas (como el firmware)
    this.historial = [];
    this.ultima = null;
  }

  iniciar() {
    if (this.timer) return;
    this.t0 = performance.now();
    this.timer = setInterval(() => this.muestra(), 1000 / HZ);
    this.muestra();
  }

  detener() { clearInterval(this.timer); this.timer = null; }

  kgEn(t) {
    // Asentamiento amortiguado: objetivo * (1 - e^(-t/0.35) * cos(2*pi*t/0.9)), desde el valor previo.
    return this.kgObjetivo + (this.kgDesde - this.kgObjetivo) * Math.exp(-t / 0.35) * Math.cos((2 * Math.PI * t) / 0.9);
  }

  // opciones: { kgObjetivo } (bruto) o { litros }; si no, litros ~ U(9, 19.5). contaminado: NTU ~ U(140, 260).
  colocar({ kgObjetivo, litros, contaminado = false } = {}) {
    const t = (performance.now() - this.t0) / 1000;
    this.kgDesde = this.kgEn(t);
    const l = litros ?? uniforme(9, 19.5);
    this.kgObjetivo = kgObjetivo ?? this.tara + l * this.densidad;
    this.ntuBase = contaminado ? uniforme(140, 260) : uniforme(18, 65);
    this.t0 = performance.now();
    this.historial = [];
  }

  retirar() {
    const t = (performance.now() - this.t0) / 1000;
    this.kgDesde = this.kgEn(t);
    this.kgObjetivo = 0;
    this.ntuBase = null;
    this.t0 = performance.now();
    this.historial = [];
  }

  muestra() {
    const t = (performance.now() - this.t0) / 1000;
    const kgReal = Math.max(0, this.kgEn(t));
    const crudo = OFFSET + Math.round(kgReal * FACTOR) + Math.round(normal() * RUIDO_CUENTAS);
    // Mediana de 3 + media móvil exponencial, igual que el firmware ESP32.
    this.crudos.push(crudo);
    if (this.crudos.length > 3) this.crudos.shift();
    const mediana = [...this.crudos].sort((a, b) => a - b)[Math.floor(this.crudos.length / 2)];
    this.filtrado = this.filtrado === null ? mediana : this.filtrado + 0.35 * (mediana - this.filtrado);
    const raw = Math.round(this.filtrado);
    const kgExacto = (raw - OFFSET) / FACTOR;
    this.historial.push(kgExacto);
    if (this.historial.length > VENTANA_ESTABLE) this.historial.shift();
    const stable = this.historial.length === VENTANA_ESTABLE &&
      Math.max(...this.historial) - Math.min(...this.historial) < UMBRAL_ESTABLE;
    const ntu = this.ntuBase === null || kgReal < 0.5 ? null : r1(this.ntuBase + normal() * 0.4);
    this.ultima = { raw, kg: r2(Math.max(0, kgExacto)), stable, ntu, fuente: this.fuente };
    this.dispatchEvent(new CustomEvent('lectura', { detail: this.ultima }));
  }
}

// ---------- Contrato BLE (12.2) ----------
export const BLE = {
  prefijo: 'OLEO-BASCULA',
  servicio: '6f6c656f-0001-4b1a-9c2d-202610080001',
  lectura: '6f6c656f-0002-4b1a-9c2d-202610080001',
  comandos: '6f6c656f-0003-4b1a-9c2d-202610080001'
};

export const hayBluetooth = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

export class BasculaBLE extends EventTarget {
  constructor() {
    super();
    this.fuente = 'ble';
    this.dispositivo = null;
    this.carLectura = null;
    this.carComandos = null;
    this.ultima = null;
    this.decoder = new TextDecoder();
    this.alNotificar = (ev) => this.procesar(ev.target.value);
    this.alDesconectar = () => this.dispatchEvent(new CustomEvent('desconectada'));
  }

  async conectar() {
    if (!this.dispositivo) {
      this.dispositivo = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: BLE.prefijo }],
        optionalServices: [BLE.servicio]
      });
      this.dispositivo.addEventListener('gattserverdisconnected', this.alDesconectar);
    }
    const servidor = await this.dispositivo.gatt.connect();
    const servicio = await servidor.getPrimaryService(BLE.servicio);
    this.carLectura = await servicio.getCharacteristic(BLE.lectura);
    this.carComandos = await servicio.getCharacteristic(BLE.comandos);
    await this.carLectura.startNotifications();
    this.carLectura.addEventListener('characteristicvaluechanged', this.alNotificar);
    return this.dispositivo.name;
  }

  procesar(dataView) {
    try {
      const d = JSON.parse(this.decoder.decode(dataView));
      this.ultima = {
        raw: Number(d.raw), kg: r2(Number(d.kg)), stable: !!d.stable,
        ntu: d.ntu === undefined || d.ntu === null ? null : r1(Number(d.ntu)), bat: d.bat, fuente: this.fuente
      };
      this.dispatchEvent(new CustomEvent('lectura', { detail: this.ultima }));
    } catch (e) {
      console.warn('Lectura BLE inválida', e);
    }
  }

  async comando(texto) {
    if (!this.carComandos) throw new Error('Báscula no conectada');
    await this.carComandos.writeValue(new TextEncoder().encode(texto));
  }

  tarar() { return this.comando('TARE'); }
  calibrar(kg) { return this.comando(`CAL:${kg}`); }

  detener() {
    try { this.carLectura?.removeEventListener('characteristicvaluechanged', this.alNotificar); } catch { /* ya desconectada */ }
    try { if (this.dispositivo?.gatt.connected) this.dispositivo.gatt.disconnect(); } catch { /* ya desconectada */ }
  }
}
