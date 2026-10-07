// Utilidades: DOM, formato es-MX, avisos, sha256, carga diferida y sondeo.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// ---------- Formato es-MX ----------
const nf = new Map();
function formateador(dec) {
  if (!nf.has(dec)) nf.set(dec, new Intl.NumberFormat('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
  return nf.get(dec);
}
const moneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });

export const fmtNum = (n, dec = 0) => (Number.isFinite(Number(n)) ? formateador(dec).format(Number(n)) : '-');
export const fmtMoneda = (n) => (Number.isFinite(Number(n)) ? moneda.format(Number(n)) : '-');
// Espacio sin corte entre cifra y unidad.
export const fmtKg = (n) => `${fmtNum(n, 2)}\u00a0kg`;
export const fmtL = (n) => `${fmtNum(n, 2)}\u00a0L`;
export const fmtKB = (bytes) => `${fmtNum(bytes / 1024, 1)}\u00a0KB`;
export const fmtSeg = (s) => (s < 60 ? `${fmtNum(s, s < 10 ? 1 : 0)}\u00a0s` : `${Math.floor(s / 60)}\u00a0min ${Math.round(s % 60)}\u00a0s`);

const fFecha = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
const fFechaHora = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fHora = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtFecha = (iso) => (iso ? fFecha.format(new Date(iso)) : '-');
export const fmtFechaHora = (iso) => (iso ? fFechaHora.format(new Date(iso)) : '-');
export const fmtHora = (d = new Date()) => fHora.format(d);
const fTicket = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const fmtFechaTicket = (iso) => (iso ? fTicket.format(new Date(iso)).replace(',', '') : '-');

export function haceCuanto(iso, ahora = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, (ahora - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

// "OLEO202610082041074821" -> "OLEO20261008204107 4821"
export const fmtClave = (c) => String(c || '').replace(/^(OLEO\d{14})(\d{4})$/, '$1 $2');
// Sello en bloques de 8 caracteres.
export const bloques = (hex, n = 8) => (String(hex || '').match(new RegExp(`.{1,${n}}`, 'g')) || []).join(' ');

export const bytesUtf8 = (s) => new TextEncoder().encode(String(s ?? '')).length;

// ---------- Avisos ----------
export function aviso(mensaje, tipo = 'info', ms = 4200) {
  let zona = $('#avisos');
  if (!zona) {
    zona = document.createElement('div');
    zona.id = 'avisos';
    zona.setAttribute('role', 'status');
    zona.setAttribute('aria-live', 'polite');
    document.body.appendChild(zona);
  }
  const el = document.createElement('div');
  el.className = `aviso aviso-${tipo}`;
  el.textContent = mensaje;
  zona.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Diálogo de confirmación con <dialog>. Devuelve true si se acepta.
export function confirmar(mensaje, { aceptar = 'Sí', cancelar = 'Cancelar' } = {}) {
  return new Promise((resolver) => {
    const d = document.createElement('dialog');
    d.className = 'dialogo';
    d.innerHTML = `<p>${esc(mensaje)}</p>
      <div class="pila">
        <button class="btn btn-primario" value="si">${esc(aceptar)}</button>
        <button class="btn btn-secundario" value="no">${esc(cancelar)}</button>
      </div>`;
    document.body.appendChild(d);
    const cerrar = (v) => { d.close(); d.remove(); resolver(v); };
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) cerrar(b.value === 'si');
      else if (e.target === d) cerrar(false);
    });
    d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(false); });
    d.showModal();
    d.querySelector('[value="si"]').focus();
  });
}

// ---------- SHA-256 ----------
export async function sha256(texto) {
  const datos = new TextEncoder().encode(texto);
  if (globalThis.crypto?.subtle) {
    const h = await crypto.subtle.digest('SHA-256', datos);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Js(datos);
}

// Respaldo para contextos sin crypto.subtle (por ejemplo, http por IP en la red local).
function sha256Js(bytes) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const largo = bytes.length;
  const total = Math.ceil((largo + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[largo] = 0x80;
  const vista = new DataView(m.buffer);
  vista.setUint32(total - 4, (largo * 8) >>> 0);
  vista.setUint32(total - 8, Math.floor((largo * 8) / 2 ** 32));
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) W[t] = vista.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// ---------- Carga diferida de librerías clásicas ----------
const cargados = new Map();
export function cargarScript(src) {
  if (!cargados.has(src)) {
    cargados.set(src, new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = ok;
      s.onerror = () => { cargados.delete(src); mal(new Error(`No se pudo cargar ${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return cargados.get(src);
}

export function cargarCSS(href) {
  if (!$(`link[href="${href}"]`)) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }
}

// ---------- Varios ----------
export function pinAleatorio() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 10000).padStart(4, '0');
}

export const vibrar = (ms = 60) => { try { navigator.vibrate?.(ms); } catch { /* sin vibración */ } };
export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
export const reducirMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Sondeo con límite (sección 7.4). fn() devuelve true para terminar.
// No cuenta intentos mientras la pestaña está oculta. Se detiene con la señal de la vista.
export function sondear({ cada, max, senal, fn, alAgotar }) {
  let intentos = 0;
  let timer = null;
  let activo = false;
  const programar = () => { timer = setTimeout(paso, cada); };
  async function paso() {
    if (!activo || senal?.aborted) return;
    if (document.hidden) { programar(); return; }
    intentos++;
    let terminar = false;
    try { terminar = await fn(intentos); } catch (e) { console.error(e); }
    if (!activo || senal?.aborted) return;
    if (terminar) { activo = false; return; }
    if (intentos >= max) { activo = false; alAgotar?.(); return; }
    programar();
  }
  const control = {
    iniciar() { clearTimeout(timer); intentos = 0; activo = true; programar(); },
    detener() { activo = false; clearTimeout(timer); },
    get activo() { return activo; },
    get intentos() { return intentos; }
  };
  senal?.addEventListener('abort', () => control.detener());
  return control;
}

// Ícono SVG en línea (trazos simples, heredan el color del texto).
const ICONOS = {
  inicio: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  puesto: '<path d="M3 9h18l-1.5-4h-15zM4.5 9v11h15V9M9 20v-6h6v6"/><path d="M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3"/>',
  recolector: '<path d="M2 7h11v9H2zM13 10h4l3 3v3h-7"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  impacto: '<path d="M12 3c3.5 4.2 6 7.5 6 10.5a6 6 0 0 1-12 0C6 10.5 8.5 7.2 12 3z"/><path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.5"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>',
  actualizar: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  verificado: '<path d="M12 3l7 3v5.5c0 4.3-3 7.8-7 9.5-4-1.7-7-5.2-7-9.5V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  alerta: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  borrar: '<path d="M21 6H8l-6 6 6 6h13zM12 9.5l5 5M17 9.5l-5 5"/>'
};
export const icono = (nombre, clase = 'icono') =>
  `<svg class="${clase}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ''}</svg>`;
