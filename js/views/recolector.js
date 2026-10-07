// Vistas del recolector (sección 10.7), tema noche.

import * as api from '../api.js';
import { obtenerConfig } from '../config.js';
import { derivar } from '../metrics.js';
import { planearRuta, ZOCALO } from '../route.js';
import { BasculaSimulada, BasculaBLE, hayBluetooth } from '../scale.js';
import { Escaner, leerContenido } from '../qr.js';
import { $, esc, fmtNum, fmtKg, fmtL, fmtMoneda, fmtSeg, haceCuanto, aviso, sondear, cargarScript, cargarCSS, icono } from '../util.js';
import { cadenaDato, metricasVerdes, botonActualizar, mensajeError } from './componentes.js';
import { normalizarPuestoId } from './comerciante.js';

const destinoPesar = (puestoRecId, puestoId, solicitudId) =>
  `#/recolector/pesar/${encodeURIComponent(puestoRecId)}?p=${encodeURIComponent(puestoId || '')}${solicitudId ? `&s=${encodeURIComponent(solicitudId)}` : ''}`;

// ---------- Ruta de esta noche ----------
export async function ruta({ raiz, senal }) {
  const c = obtenerConfig();
  raiz.innerHTML = `
    <div class="fila-entre">
      <div class="encabezado">
        <h1>Ruta de esta noche</h1>
        <p class="secundario">${esc(c.ventana)}, ${esc(c.recolector)}</p>
      </div>
      ${botonActualizar()}
    </div>
    <div id="zona-mapa"></div>
    <div id="zona-lista"><p class="cargando">Consultando solicitudes</p></div>
    <a class="btn btn-primario btn-flotante" href="#/recolector/escanear">${icono('qr')}Escanear QR del bote</a>`;

  let inicio = ZOCALO;
  let origen = 'Zócalo';
  let solicitudes = api.cache.pendientes;
  let mapa = null;
  senal.addEventListener('abort', () => mapa?.remove());

  function pintar() {
    const zonaLista = $('#zona-lista', raiz);
    if (!solicitudes) return;
    if (!solicitudes.length) {
      $('#zona-mapa', raiz).innerHTML = '';
      mapa?.remove(); mapa = null;
      zonaLista.innerHTML = `<div class="panel"><p>No hay solicitudes pendientes. Cuando un comerciante avise que su bote está lleno, aparecerá aquí.</p></div>`;
      return;
    }
    const plan = planearRuta(solicitudes, inicio);
    const ahora = Date.now();
    zonaLista.innerHTML = `
      <p class="chico secundario">${plan.paradas.length} ${plan.paradas.length === 1 ? 'parada' : 'paradas'}. Total estimado: <strong>${fmtNum(plan.totalKm, 1)} km</strong> desde ${esc(origen)}. Ruta estimada en línea recta.</p>
      ${plan.clusters.map((cl) => `
        <section class="seccion">
          <div class="cluster-titulo"><span>${esc(cl.alcaldia)}</span><span class="chico secundario">${cl.paradas.length} ${cl.paradas.length === 1 ? 'parada' : 'paradas'}</span></div>
          <ul class="lista">
            ${cl.paradas.map((p) => `<li class="parada">
              <span class="parada-num" aria-label="Parada ${p.orden}">${p.orden}</span>
              <div class="pila-chica">
                <span class="fuerte">${esc(p.nombre || p.puestoId)}</span>
                <span class="parada-meta">${esc(p.puestoId)}. Bote al ${fmtNum(p.nivel)}% <span class="mini-nivel"><span style="width:${Math.min(100, p.nivel)}%"></span></span></span>
                <span class="parada-meta">Cierra ${esc(p.cierre || '-')}. Avisó ${haceCuanto(p.creada, ahora)}. ${fmtNum(p.distanciaKm, 1)} km ${p.orden === 1 ? 'desde el inicio' : 'desde la parada anterior'}${p.sinUbicacion ? ' (ubicación aproximada)' : ''}.</span>
              </div>
              <a class="btn-chico" href="${destinoPesar(p.puestoRecId, p.puestoId, p.id)}">Pesar</a>
            </li>`).join('')}
          </ul>
        </section>`).join('')}`;
    pintarMapa(plan).catch((e) => {
      console.warn('Mapa no disponible', e);
      $('#zona-mapa', raiz).innerHTML = '';
    });
  }

  async function pintarMapa(plan) {
    cargarCSS('vendor/leaflet/leaflet.css');
    await cargarScript('vendor/leaflet/leaflet.js');
    if (senal.aborted) return;
    const L = window.L;
    const zona = $('#zona-mapa', raiz);
    if (!mapa) {
      zona.innerHTML = '<div class="mapa" id="mapa" role="img" aria-label="Mapa de la ruta"></div>';
      mapa = L.map($('#mapa', raiz), { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(mapa);
      mapa.capa = L.layerGroup().addTo(mapa);
    }
    mapa.capa.clearLayers();
    const color = getComputedStyle(document.documentElement).getPropertyValue('--lona').trim() || '#E2558F';
    const puntos = [[plan.inicio.lat, plan.inicio.lng], ...plan.paradas.map((p) => [p.pos.lat, p.pos.lng])];
    L.polyline(puntos, { color, weight: 3, opacity: 0.85, dashArray: '6 6' }).addTo(mapa.capa);
    L.marker(puntos[0], { icon: L.divIcon({ className: '', html: '<span class="marcador marcador-inicio"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }), title: `Inicio: ${origen}` }).addTo(mapa.capa);
    plan.paradas.forEach((p) => {
      L.marker([p.pos.lat, p.pos.lng], {
        icon: L.divIcon({ className: '', html: `<span class="marcador">${p.orden}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: `${p.orden}. ${p.nombre}`
      }).addTo(mapa.capa);
    });
    mapa.fitBounds(L.latLngBounds(puntos), { padding: [28, 28], maxZoom: 15 });
  }

  async function cargar() {
    const b = $('#btn-actualizar', raiz);
    b.disabled = true;
    try {
      solicitudes = await api.pendientes();
      if (!senal.aborted) pintar();
    } catch (e) {
      if (!senal.aborted) $('#zona-lista', raiz).innerHTML = mensajeError(e);
    } finally { b.disabled = false; }
  }
  $('#btn-actualizar', raiz).addEventListener('click', cargar);

  // Inicio de la ruta: ubicación del recolector si la concede; si no, el Zócalo.
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      if (senal.aborted) return;
      inicio = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      origen = 'tu ubicación';
      pintar();
    }, () => {}, { timeout: 6000, maximumAge: 300000 });
  }
  await cargar();
}

// ---------- Escáner ----------
export async function escanear({ raiz, senal, ir }) {
  raiz.innerHTML = `
    <div class="encabezado">
      <h1>Escanear QR del bote</h1>
      <p class="secundario">Apunta la cámara a la etiqueta del bote.</p>
    </div>
    <div class="escaner">
      <video id="video" playsinline muted></video>
      <div class="guia" aria-hidden="true"></div>
      <p class="estado-camara" id="estado-camara">Encendiendo la cámara</p>
    </div>
    <form id="form-manual" class="pila" novalidate>
      <div class="campo">
        <label for="m-id">Puesto ID</label>
        <div class="fila">
          <input id="m-id" name="puestoId" placeholder="OLEO-0007" autocapitalize="characters" autocomplete="off">
          <button class="btn btn-secundario" style="width:auto" type="submit">Buscar</button>
        </div>
      </div>
    </form>
    <div id="zona-error" role="alert"></div>
    <a class="btn-texto" href="#/recolector">Volver a la ruta</a>`;

  const estado = $('#estado-camara', raiz);
  const zonaError = $('#zona-error', raiz);
  let ocupado = false;

  const escaner = new Escaner($('#video', raiz), { alLeer: (t) => resolver(t, true), alEstado: (t) => { estado.textContent = t; } });
  senal.addEventListener('abort', () => escaner.detener());

  async function arrancar() {
    try {
      await escaner.iniciar();
    } catch (e) {
      console.warn('Cámara no disponible', e);
      if (senal.aborted) return;
      estado.textContent = 'Permite el acceso a la cámara o escribe el Puesto ID.';
    }
  }

  async function resolver(texto, desdeCamara) {
    if (ocupado) return;
    const c = leerContenido(texto) || (desdeCamara ? null : (normalizarPuestoId(texto) && { puestoId: normalizarPuestoId(texto), recId: null }));
    if (!c) {
      zonaError.innerHTML = `<p class="mensaje-error">${desdeCamara ? 'Ese QR no es de un bote OLEO.' : 'Escribe un Puesto ID como OLEO-0007.'}</p>`;
      if (desdeCamara) { escaner.cancelado = false; arrancar(); }
      return;
    }
    ocupado = true;
    zonaError.innerHTML = '';
    estado.textContent = `Leído: ${c.puestoId}`;
    try {
      let recId = c.recId;
      if (!recId) {
        const p = await api.buscarPuesto(c.puestoId);
        if (!p) {
          zonaError.innerHTML = `<p class="mensaje-error">No encontramos el puesto ${esc(c.puestoId)}.</p>`;
          ocupado = false;
          return;
        }
        recId = p.id;
      }
      if (!api.cache.pendientes) await api.pendientes().catch(() => null);
      const s = api.cache.pendientes?.find((x) => x.puestoRecId === recId || x.puestoId === c.puestoId);
      if (!senal.aborted) ir(destinoPesar(recId, c.puestoId, s?.id));
    } catch (e) {
      zonaError.innerHTML = mensajeError(e);
      ocupado = false;
    }
  }

  $('#form-manual', raiz).addEventListener('submit', (e) => {
    e.preventDefault();
    resolver($('#m-id', raiz).value, false);
  });
  arrancar();
}

// ---------- Pesaje y calidad ----------
export async function pesar({ raiz, params, query, senal, ir }) {
  const c = obtenerConfig();
  let recIdPuesto = params.id;
  raiz.innerHTML = '<p class="cargando">Cargando el puesto</p>';

  // Datos del puesto: caché de la ruta o del escáner; si no, una consulta.
  const sol = api.cache.pendientes?.find((s) => s.id === query.s || s.puestoRecId === recIdPuesto);
  let puesto = api.cache.puestos.get(recIdPuesto) ||
    (sol ? { id: sol.puestoRecId, puestoId: sol.puestoId, nombre: sol.nombre, alcaldia: sol.alcaldia, cierre: sol.cierre } : null);
  if (!puesto) {
    try {
      puesto = await api.obtenerPuesto(recIdPuesto);
    } catch (e) {
      if (query.p) puesto = await api.buscarPuesto(query.p).catch(() => null);
      if (!puesto) { raiz.innerHTML = mensajeError(e) + '<a class="btn btn-secundario" href="#/recolector/escanear">Escanear de nuevo</a>'; return; }
    }
    recIdPuesto = puesto.id;
  }
  if (senal.aborted) return;

  raiz.innerHTML = `
    <div class="encabezado">
      <p class="secundario">${esc(puesto.puestoId)}${puesto.alcaldia ? `, ${esc(puesto.alcaldia)}` : ''}</p>
      <h1>${esc(puesto.nombre || puesto.puestoId)}</h1>
      ${sol ? `<p class="chico secundario">Avisó con el bote al ${fmtNum(sol.nivel)}%.</p>` : ''}
    </div>

    <div class="fila fila-envuelve" role="group" aria-label="Báscula">
      <span class="etiqueta-sim" id="fuente-bascula">Báscula simulada</span>
      ${hayBluetooth() ? '<button class="btn-chico" id="btn-ble">Conectar báscula Bluetooth</button>' : ''}
      <button class="btn-chico" id="btn-simulada" hidden>Usar báscula simulada</button>
    </div>

    <section class="visor" id="visor" data-estable="no" aria-label="Visor de la báscula">
      <div class="visor-cabeza"><span>Peso bruto</span><span class="visor-led" id="visor-led">Estable</span></div>
      <div class="visor-cifra">
        <span class="visor-digitos" aria-live="off"><span class="fantasma" aria-hidden="true">88.88</span><span id="visor-kg" style="white-space:pre"> 0.00</span></span>
        <span class="visor-unidad">kg</span>
      </div>
      <div class="visor-crudo" id="visor-crudo">Lectura cruda HX711: - cuentas</div>
    </section>

    <div class="pila" id="acciones-sim">
      <button class="btn btn-oscuro" id="btn-colocar">Colocar bote en la báscula</button>
      <button class="btn btn-secundario" id="btn-retirar">Retirar bote</button>
      <details class="ajustes-sim">
        <summary>Ajustes de simulación</summary>
        <div class="pila">
          <label class="casilla"><input type="checkbox" id="sim-aleatorio" checked> Peso aleatorio (9 a 19.5 L)</label>
          <div class="campo">
            <label for="sim-kg">Kg objetivo (bruto): <span id="sim-kg-valor">14.86</span> kg</label>
            <input type="range" id="sim-kg" min="2" max="20" step="0.01" value="14.86" disabled>
          </div>
          <label class="casilla"><input type="checkbox" id="sim-contaminado"> Simular lote contaminado</label>
        </div>
      </details>
    </div>
    <div class="pila" id="acciones-ble" hidden>
      <button class="btn btn-secundario" id="btn-tarar">Poner en cero (TARE)</button>
    </div>

    <div class="campo">
      <label for="tara">Tara del bote (kg)</label>
      <input id="tara" type="number" inputmode="decimal" step="0.01" min="0" max="5" value="${c.taraKg.toFixed(2)}">
    </div>

    <section class="seccion" aria-labelledby="titulo-calculo">
      <h2 id="titulo-calculo">Validación en calle</h2>
      <dl class="datos" id="calculos"></dl>
    </section>

    <div id="zona-revisar"></div>
    <div id="zona-error" role="alert"></div>
    <button class="btn btn-primario" id="btn-registrar" disabled>Registrar recolección</button>
    <p class="nota" id="nota-registrar">Coloca el bote y espera la lectura estable.</p>`;

  let bascula = new BasculaSimulada({ tara: c.taraKg, densidad: c.densidad });
  let lectura = null;
  let registrando = false;
  const tara = () => { const t = Number($('#tara', raiz).value); return Number.isFinite(t) && t >= 0 ? t : c.taraKg; };

  const alLeer = (ev) => { lectura = ev.detail; pintarLectura(); };
  function usar(b) {
    bascula.removeEventListener('lectura', alLeer);
    bascula.detener();
    bascula = b;
    bascula.addEventListener('lectura', alLeer);
    if (b instanceof BasculaSimulada) b.iniciar();
  }
  usar(bascula);
  senal.addEventListener('abort', () => bascula.detener());

  function pintarLectura() {
    const l = lectura;
    if (!l) return;
    const visor = $('#visor', raiz);
    visor.dataset.estable = l.stable ? 'si' : 'no';
    $('#visor-kg', raiz).textContent = l.kg.toFixed(2).padStart(5, ' ');
    $('#visor-crudo', raiz).textContent = `Lectura cruda HX711: ${fmtNum(l.raw)} cuentas`;
    const d = derivar({ brutoKg: l.kg, taraKg: tara(), densidad: c.densidad, precioLitro: c.precioLitro, ntu: l.ntu ?? 0, umbral: c.umbralNTU });
    const hayNtu = l.ntu !== null && l.ntu !== undefined;
    $('#calculos', raiz).innerHTML = `
      <dt>Peso neto</dt><dd>${fmtKg(d.neto)}</dd>
      <dt>Litros (÷ ${fmtNum(c.densidad, 2)} kg/L)</dt><dd>${fmtL(d.litros)}</dd>
      <dt>Turbidez</dt><dd>${hayNtu ? `${fmtNum(l.ntu, 1)} NTU, <span class="calidad" data-calidad="${d.calidad}">${d.calidad}</span>` : '-'}</dd>
      <dt>Precio por litro</dt><dd>${fmtMoneda(c.precioLitro)}</dd>
      <dt>Monto</dt><dd>${fmtMoneda(d.monto)}</dd>
      <dt>Agua protegida</dt><dd>${fmtNum(d.agua)} L</dd>`;

    const revisar = hayNtu && d.calidad === 'Revisar';
    const zonaRev = $('#zona-revisar', raiz);
    if (revisar && !zonaRev.innerHTML) {
      zonaRev.innerHTML = `<div class="panel panel-alerta pila">
        <p class="fuerte">${icono('alerta', 'icono')}El lote parece tener agua o sólidos. No se acepta en calle.</p>
        <button class="btn btn-peligro" id="btn-rechazar-lote">Rechazar lote</button>
      </div>`;
      $('#btn-rechazar-lote', raiz).addEventListener('click', () => { aviso('Lote rechazado. No se registró ninguna recolección.'); ir('#/recolector'); });
    } else if (!revisar && zonaRev.innerHTML) {
      zonaRev.innerHTML = '';
    }
    const listo = l.stable && d.neto > 0.5 && hayNtu && d.calidad === 'Aceptado';
    $('#btn-registrar', raiz).disabled = !listo || registrando;
    $('#nota-registrar', raiz).textContent = listo ? 'Lectura estable y lote aceptado.'
      : revisar ? 'Calidad en revisión: no se puede registrar.'
      : d.neto <= 0.5 ? 'Coloca el bote y espera la lectura estable.'
      : 'Esperando lectura estable.';
  }

  // ----- Controles de simulación -----
  const aleatorio = $('#sim-aleatorio', raiz);
  const kgObj = $('#sim-kg', raiz);
  aleatorio.addEventListener('change', () => { kgObj.disabled = aleatorio.checked; });
  kgObj.addEventListener('input', () => { $('#sim-kg-valor', raiz).textContent = Number(kgObj.value).toFixed(2); });
  $('#btn-colocar', raiz).addEventListener('click', () => {
    if (!(bascula instanceof BasculaSimulada)) return;
    bascula.tara = tara();
    bascula.colocar({ kgObjetivo: aleatorio.checked ? undefined : Number(kgObj.value), contaminado: $('#sim-contaminado', raiz).checked });
  });
  $('#btn-retirar', raiz).addEventListener('click', () => { if (bascula instanceof BasculaSimulada) bascula.retirar(); });
  $('#tara', raiz).addEventListener('input', pintarLectura);

  // ----- Báscula Bluetooth -----
  function modoFuente(ble, nombre) {
    $('#fuente-bascula', raiz).textContent = ble ? `Báscula Bluetooth ${nombre || ''}`.trim() : 'Báscula simulada';
    $('#acciones-sim', raiz).hidden = ble;
    $('#acciones-ble', raiz).hidden = !ble;
    $('#btn-simulada', raiz).hidden = !ble;
    if ($('#btn-ble', raiz)) $('#btn-ble', raiz).hidden = ble;
  }
  $('#btn-ble', raiz)?.addEventListener('click', async () => {
    const ble = new BasculaBLE();
    try {
      const nombre = await ble.conectar();
      ble.addEventListener('desconectada', async () => {
        aviso('Se desconectó la báscula', 'error');
        $('#btn-ble', raiz).hidden = false;
        $('#btn-ble', raiz).textContent = 'Reconectar báscula Bluetooth';
      });
      usar(ble);
      lectura = null;
      modoFuente(true, nombre);
    } catch (e) {
      if (e.name !== 'NotFoundError') aviso(`No se pudo conectar la báscula: ${e.message}`, 'error');
    }
  });
  $('#btn-simulada', raiz).addEventListener('click', () => { usar(new BasculaSimulada({ tara: tara(), densidad: c.densidad })); lectura = null; modoFuente(false); });
  $('#btn-tarar', raiz).addEventListener('click', () => bascula.tarar?.().catch((e) => aviso(e.message, 'error')));

  // ----- Registrar -----
  $('#btn-registrar', raiz).addEventListener('click', async () => {
    const l = lectura;
    if (!l || registrando) return;
    registrando = true;
    const btn = $('#btn-registrar', raiz);
    btn.disabled = true;
    btn.textContent = 'Registrando';
    const d = derivar({ brutoKg: l.kg, taraKg: tara(), densidad: c.densidad, precioLitro: c.precioLitro, ntu: l.ntu, umbral: c.umbralNTU });
    const fechaValidacion = new Date().toISOString();
    try {
      const r = await api.registrar({
        puestoRecId: recIdPuesto, recolector: c.recolector, raw: l.raw, brutoKg: l.kg, taraKg: tara(),
        densidad: c.densidad, ntu: l.ntu, precio: c.precioLitro, fechaValidacion, solicitudId: query.s
      });
      if (r.pendiente) {
        try {
          sessionStorage.setItem(`oleo.local.${r.id}`, JSON.stringify({ litros: d.litros, monto: d.monto, netoKg: d.neto, fechaValidacion, puestoId: puesto.puestoId, nombre: puesto.nombre, puestoRecId: recIdPuesto }));
        } catch { /* sin almacenamiento */ }
        aviso('Sin señal. La recolección quedó guardada en este teléfono y se enviará sola al recuperar conexión.');
      }
      bascula.detener();
      ir(`#/recolector/espera/${r.id}`);
    } catch (e) {
      registrando = false;
      btn.textContent = 'Registrar recolección';
      $('#zona-error', raiz).innerHTML = mensajeError(e);
      pintarLectura();
    }
  });
}

// ---------- Esperando confirmación ----------
function cronometro(el, desdeIso, senal) {
  const t0 = new Date(desdeIso).getTime();
  const pintar = () => {
    const s = Math.max(0, Math.floor((Date.now() - t0) / 1000));
    el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  pintar();
  const id = setInterval(pintar, 1000);
  senal.addEventListener('abort', () => clearInterval(id));
  return () => clearInterval(id);
}

export async function espera({ raiz, params, senal, ir }) {
  const c = obtenerConfig();
  const id = params.id;

  // Recolección todavía en la cola offline.
  if (id.startsWith('local-')) {
    const real = api.resueltoDe(id);
    if (real) return ir(`#/recolector/espera/${real}`, { reemplazar: true });
    let local = {};
    try { local = JSON.parse(sessionStorage.getItem(`oleo.local.${id}`)) || {}; } catch { /* sin datos */ }
    raiz.innerHTML = `
      <div class="encabezado">
        <h1>Recolección guardada en este teléfono</h1>
        <p class="secundario">${esc(local.nombre || '')}${local.puestoId ? `, ${esc(local.puestoId)}` : ''}</p>
      </div>
      <div class="panel panel-alerta pila-chica" role="status">
        <p class="fuerte">Sin señal. La recolección quedó guardada en este teléfono y se enviará sola al recuperar conexión.</p>
        <p class="chico">Cuando se envíe, esta pantalla sigue esperando la confirmación del comerciante.</p>
      </div>
      <dl class="datos"><dt>Litros</dt><dd>${fmtL(local.litros)}</dd><dt>Monto</dt><dd>${fmtMoneda(local.monto)}</dd></dl>
      <div><p class="chico secundario">Del pesaje al abono</p><p class="cronometro" id="crono">00:00</p></div>
      <button class="btn btn-secundario" id="btn-enviar-ahora">Enviar ahora</button>`;
    if (local.fechaValidacion) cronometro($('#crono', raiz), local.fechaValidacion, senal);
    const quitar = api.alCambiarCola((ev) => {
      if (ev.tipo === 'enviado' && ev.localId === id && !senal.aborted) ir(`#/recolector/espera/${ev.registro.id}`, { reemplazar: true });
    });
    senal.addEventListener('abort', quitar);
    $('#btn-enviar-ahora', raiz).addEventListener('click', () => api.procesarCola());
    return;
  }

  let rec = api.cache.recolecciones.get(id);
  if (!rec) {
    try { rec = await api.obtenerRecoleccion(id); } catch (e) { raiz.innerHTML = mensajeError(e); return; }
  }
  if (senal.aborted) return;
  if (rec.estado === 'Pagada') return ir(`#/recolector/pagado/${id}`, { reemplazar: true });

  raiz.innerHTML = `
    <div class="encabezado">
      <h1>${esc(rec.folio)} registrada.</h1>
      <p class="secundario">Esperando la confirmación del comerciante.</p>
    </div>
    <div class="resumen">
      <div><span class="valor">${fmtL(rec.litros)}</span><span class="rotulo">${fmtKg(rec.netoKg)} netos</span></div>
      <div><span class="valor">${fmtMoneda(rec.monto)}</span><span class="rotulo">pago</span></div>
      <div><span class="valor">${fmtNum(rec.agua)}</span><span class="rotulo">L de agua protegidos</span></div>
    </div>
    <div class="fila-entre">
      <div><p class="chico secundario">Del pesaje al abono</p><p class="cronometro" id="crono">00:00</p></div>
      ${botonActualizar()}
    </div>
    <div id="zona-estado" aria-live="polite"><p class="chico secundario">${esc(rec.nombre || '')}, ${esc(rec.puestoId || '')}. Consultando cada ${fmtNum(c.pollRecolectorMs / 1000)} s.</p></div>

    <section class="seccion" aria-labelledby="titulo-pin">
      <h2 id="titulo-pin">Comerciante sin datos</h2>
      <p class="chico secundario">Úsalo si el comerciante no tiene datos.</p>
      <button class="btn btn-secundario" id="btn-mostrar-pin" aria-expanded="false">Confirmar con PIN</button>
      <div id="zona-pin" class="pila" hidden>
        <div class="pin-puntos" id="pin-puntos" aria-label="PIN de 0 dígitos"><span></span><span></span><span></span><span></span></div>
        <div class="teclado" id="teclado">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-d="${n}">${n}</button>`).join('')}
          <button type="button" data-d="borrar" aria-label="Borrar">${icono('borrar')}</button>
          <button type="button" data-d="0">0</button>
          <span></span>
        </div>
        <div id="error-pin" role="alert"></div>
        <button class="btn btn-primario" id="btn-confirmar-pin" disabled>Confirmar con PIN</button>
      </div>
    </section>`;

  const parar = cronometro($('#crono', raiz), rec.fechaValidacion, senal);

  const zonaEstado = $('#zona-estado', raiz);
  function rechazada() {
    parar();
    sondeo.detener();
    zonaEstado.innerHTML = `<div class="panel panel-alerta pila">
      <p class="fuerte">El comerciante indicó que no coincide. Vuelve a pesar.</p>
      <a class="btn btn-primario" href="${destinoPesar(rec.puestoRecId, rec.puestoId)}">Volver a pesar</a>
    </div>`;
    $('#btn-mostrar-pin', raiz).disabled = true;
  }

  async function consultar() {
    const r = await api.obtenerRecoleccion(id);
    if (senal.aborted) return true;
    if (r.estado === 'Pagada') { ir(`#/recolector/pagado/${id}`, { reemplazar: true }); return true; }
    if (r.estado === 'Rechazada') { rechazada(); return true; }
    return false;
  }
  const sondeo = sondear({
    cada: c.pollRecolectorMs, max: c.pollRecolectorMax, senal, fn: consultar,
    alAgotar: () => { zonaEstado.innerHTML = '<p class="chico secundario">Dejamos de consultar para ahorrar datos. Usa "Actualizar".</p>'; }
  });
  if (rec.estado === 'Rechazada') rechazada(); else sondeo.iniciar();

  $('#btn-actualizar', raiz).addEventListener('click', async () => {
    try { if (!(await consultar()) && !sondeo.activo) sondeo.iniciar(); } catch (e) { aviso(e.message, 'error'); }
  });

  // ----- PIN en sitio -----
  let pin = '';
  const pintarPin = () => {
    $('#pin-puntos', raiz).querySelectorAll('span').forEach((s, i) => s.classList.toggle('lleno', i < pin.length));
    $('#pin-puntos', raiz).setAttribute('aria-label', `PIN de ${pin.length} dígitos`);
    $('#btn-confirmar-pin', raiz).disabled = pin.length !== 4;
  };
  $('#btn-mostrar-pin', raiz).addEventListener('click', (ev) => {
    const zona = $('#zona-pin', raiz);
    zona.hidden = !zona.hidden;
    ev.currentTarget.setAttribute('aria-expanded', String(!zona.hidden));
    ev.currentTarget.hidden = !zona.hidden;
  });
  $('#teclado', raiz).addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.d === 'borrar') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += b.dataset.d;
    $('#error-pin', raiz).innerHTML = '';
    pintarPin();
  });
  $('#btn-confirmar-pin', raiz).addEventListener('click', async () => {
    const btn = $('#btn-confirmar-pin', raiz);
    btn.disabled = true;
    btn.textContent = 'Cobrando';
    try {
      await api.pagar(id, pin, 'pin');
      sondeo.detener();
      ir(`#/recolector/pagado/${id}`, { reemplazar: true });
    } catch (e) {
      $('#error-pin', raiz).innerHTML = `<p class="mensaje-error">${esc(e.message)}</p>`;
      btn.textContent = e.tipo === 'red' || e.tipo === 'tiempo' ? 'Reintentar' : 'Confirmar con PIN';
      if (e.tipo === 'conflicto') pin = '';
      pintarPin();
    }
  });
}

// ---------- Pagado ----------
export async function pagado({ raiz, params, senal }) {
  const id = params.id;
  let rec = api.cache.recolecciones.get(id);
  if (!rec || rec.estado !== 'Pagada') {
    try { rec = await api.obtenerRecoleccion(id); } catch (e) { raiz.innerHTML = mensajeError(e); return; }
  }
  if (senal.aborted) return;
  const pago = api.pagoLocal(id);
  const total = Number.isFinite(rec.segundosAbono) ? rec.segundosAbono
    : rec.fechaAbono && rec.fechaValidacion ? (new Date(rec.fechaAbono) - new Date(rec.fechaValidacion)) / 1000 : null;

  raiz.innerHTML = `
    <div class="abono-ok">
      <p class="secundario">${esc(rec.folio)}, ${esc(rec.nombre || '')}</p>
      <h1>Abono ejecutado</h1>
      <p class="grande">${fmtMoneda(rec.monto)} al puesto ${esc(rec.puestoId || '')} por ${fmtL(rec.litros)}.</p>
      <p class="chico secundario">Confirmado por ${esc((rec.canal || 'App del comerciante').toLowerCase())}. Transferencia SPEI simulada.</p>
    </div>
    <div class="tiempos">
      ${pago ? `<div><p class="chico secundario">Confirmación a abono</p><p class="valor">${fmtSeg(pago.latenciaMs / 1000)}</p></div>` : ''}
      <div><p class="chico secundario">Del pesaje al abono</p><p class="valor">${total === null ? '-' : fmtSeg(total)}</p></div>
    </div>
    ${cadenaDato(rec)}
    <section class="seccion" aria-label="Métricas verdes de esta entrega">
      <h2>Métricas verdes de esta entrega</h2>
      ${metricasVerdes(rec)}
    </section>
    <div class="pila">
      <a class="btn btn-secundario" href="#/constancia/${esc(id)}">Ver constancia</a>
      <a class="btn btn-primario" href="#/recolector">Siguiente puesto</a>
    </div>`;
}
