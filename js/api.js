// Capa de datos del frontend (sección 8): un adaptador de dominio, dos transportes (nube/local),
// cola offline y medidor de bytes. Siempre habla el contrato de la sección 7.3.

import { obtenerConfig, modoEfectivo, CONTENEDOR } from './config.js';
import { bytesUtf8, aviso } from './util.js';

const TIEMPO_MAX_MS = 20000;

export class ErrorOleo extends Error {
  constructor(tipo, mensaje, extra = {}) {
    super(mensaje);
    this.tipo = tipo;       // red | tiempo | no-json | airtable | conflicto | accion | servidor
    Object.assign(this, extra);
  }
}

// ---------- Medidor de bytes ----------
let totalBytes = 0;
const oyentesBytes = new Set();
export const alMedir = (fn) => { oyentesBytes.add(fn); return () => oyentesBytes.delete(fn); };
// Ejecuta fn y devuelve [resultado, bytes usados durante esa operación del usuario].
export async function medir(fn) {
  const antes = totalBytes;
  const r = await fn();
  return [r, totalBytes - antes];
}

// ---------- Transportes ----------
let simulador = null;
export async function obtenerSimulador() {
  if (!simulador) {
    const { crearSimulador } = await import('./sim/make-airtable-sim.js');
    simulador = crearSimulador({
      almacen: {
        leer: () => { try { return JSON.parse(localStorage.getItem('oleo.sim.db')); } catch { return null; } },
        escribir: (db) => { try { localStorage.setItem('oleo.sim.db', JSON.stringify(db)); } catch (e) { console.error(e); } }
      },
      bitacora: (e) => console.debug('[OLEO sim]', e.escenario, e.accion, e.ruta || '', e.status, `${e.creditos} créditos`, e.detalle || '')
    });
  }
  return simulador;
}

async function transporteLocal(campos) {
  const sim = await obtenerSimulador();
  const cuerpo = new URLSearchParams(campos).toString();
  // Make recibe todo como texto: se reconstruye igual que lo haría el webhook.
  const r = await sim.oleoApi(Object.fromEntries(new URLSearchParams(cuerpo)));
  return { status: r.status, texto: r.body, bytes: bytesUtf8(cuerpo) + bytesUtf8(r.body) };
}

async function transporteNube(campos, url, tiempoMs = TIEMPO_MAX_MS) {
  const cuerpo = new URLSearchParams(campos);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), tiempoMs);
  try {
    // form-urlencoded = simple request de CORS: sin preflight OPTIONS. No agregar headers.
    const resp = await fetch(url, { method: 'POST', body: cuerpo, signal: ctrl.signal, cache: 'no-store' });
    const texto = await resp.text();
    return { status: resp.status, texto, bytes: bytesUtf8(cuerpo.toString()) + bytesUtf8(texto) };
  } catch (e) {
    if (e.name === 'AbortError') throw new ErrorOleo('tiempo', `Make tardó más de ${Math.round(tiempoMs / 1000)} s en responder. Intenta de nuevo.`);
    throw new ErrorOleo('red', 'Sin conexión con el servidor. Revisa tu señal e intenta de nuevo.', { causa: e });
  } finally {
    clearTimeout(t);
  }
}

// Interfaz del transporte: devuelve { status, json, bytes }.
export async function enviar(campos, { tiempoMs } = {}) {
  const c = obtenerConfig();
  const local = modoEfectivo(c) === 'local';
  const r = local ? await transporteLocal(campos) : await transporteNube(campos, c.webhook, tiempoMs);
  totalBytes += r.bytes;
  oyentesBytes.forEach((fn) => fn(r.bytes, totalBytes));
  let json;
  try { json = JSON.parse(r.texto); } catch {
    console.error('Respuesta de Make sin JSON', r.status, r.texto);
    throw new ErrorOleo('no-json', 'El escenario de Make no respondió. Revisa que esté activo.', { status: r.status, texto: r.texto });
  }
  return { status: r.status, json, bytes: r.bytes };
}

async function db(ruta, metodo, cuerpo) {
  const { status, json } = await enviar({ accion: 'db', ruta, metodo, cuerpo: cuerpo ? JSON.stringify(cuerpo) : '' });
  if (json && json.error) {
    console.error(`Airtable/Make ${status} en ${metodo} ${ruta}`, json.error);
    const msg = json.error.type === 'AIRTABLE_ERROR' ? json.error.message
      : `Airtable rechazó la operación (${json.error.type || status}).`;
    throw new ErrorOleo('airtable', msg, { status, detalle: json.error });
  }
  if (status === 400) throw new ErrorOleo('accion', json?.error || 'Acción no reconocida.', { status });
  if (status >= 400) throw new ErrorOleo('servidor', `Make respondió ${status}.`, { status });
  return json;
}

// ---------- Normalización (lookups -> primer elemento) ----------
const uno = (v) => (Array.isArray(v) ? v[0] : v);
const numero = (v) => { const n = Number(uno(v)); return Number.isFinite(n) ? n : undefined; };

export function aPuesto(r) {
  const f = r.fields || {};
  return {
    id: r.id, puestoId: f['Puesto ID'], nombre: f['Nombre del puesto'], responsable: f['Responsable'],
    tipo: f['Tipo de negocio'], alcaldia: f['Alcaldía'], colonia: f['Colonia'], cierre: f['Cierre'],
    whatsapp: f['WhatsApp'], lat: numero(f['Latitud']), lng: numero(f['Longitud']), pin: f['PIN'],
    contenedor: f['Contenedor'], alta: f['Alta'], litrosEntregados: numero(f['Litros entregados']),
    pesosGanados: numero(f['Pesos ganados']), agua: numero(f['Agua protegida (L)'])
  };
}

export function aSolicitud(r) {
  const f = r.fields || {};
  return {
    id: r.id, folio: f['Folio solicitud'], puestoRecId: uno(f['Puesto']), puestoId: uno(f['Puesto ID']),
    nombre: uno(f['Nombre del puesto']), alcaldia: uno(f['Alcaldía']), cierre: uno(f['Cierre']),
    lat: numero(f['Latitud']), lng: numero(f['Longitud']), nivel: numero(f['Nivel (%)']) ?? 0,
    estado: f['Estado'], creada: f['Creada'] || r.createdTime
  };
}

export function aRecoleccion(r) {
  const f = r.fields || {};
  return {
    id: r.id, folio: f['Folio'], puestoRecId: uno(f['Puesto']), puestoId: uno(f['Puesto ID']),
    nombre: uno(f['Nombre del puesto']), alcaldia: uno(f['Alcaldía']), recolector: f['Recolector'],
    raw: numero(f['Lectura cruda HX711']), brutoKg: numero(f['Peso bruto (kg)']), taraKg: numero(f['Tara (kg)']),
    netoKg: numero(f['Peso neto (kg)']), densidad: numero(f['Densidad (kg/L)']), litros: numero(f['Litros']),
    ntu: numero(f['Turbidez (NTU)']), calidad: f['Calidad'], precio: numero(f['Precio por litro']),
    monto: numero(f['Monto']), agua: numero(f['Agua protegida (L)']), bio: numero(f['Biocombustible potencial (L)']),
    estado: f['Estado'], canal: f['Canal de confirmación'], fechaValidacion: f['Fecha de validación'],
    fechaAbono: f['Fecha de abono'], segundosAbono: numero(f['Segundos al abono']),
    clave: f['Clave de rastreo'], constancia: f['Constancia (SHA-256)']
  };
}

const primero = (json) => (Array.isArray(json.records) ? json.records[0] : json);
// Escapa comillas simples para filterByFormula.
const lit = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// ---------- Cachés en memoria (evitan llamadas y créditos repetidos) ----------
export const cache = {
  puestos: new Map(),          // recId -> Puesto
  recolecciones: new Map(),    // recId -> Recoleccion
  pendientes: null,            // Solicitud[] de la última consulta de ruta
  pagos: new Map()             // recId -> Pago hecho en este dispositivo
};
const guardarPuesto = (p) => { cache.puestos.set(p.id, p); return p; };
const guardarRec = (r) => { cache.recolecciones.set(r.id, r); return r; };

// ---------- Funciones del adaptador (sección 8.3) ----------
export async function altaPuesto(d) {
  const fields = {
    'Nombre del puesto': d.nombre, 'Responsable': d.responsable || undefined, 'Tipo de negocio': d.tipo,
    'Alcaldía': d.alcaldia, 'Colonia': d.colonia || undefined, 'Cierre': d.cierre, 'WhatsApp': d.whatsapp || undefined,
    'Latitud': d.lat, 'Longitud': d.lng, 'PIN': d.pin, 'Contenedor': CONTENEDOR
  };
  const json = await db('Puestos', 'POST', { records: [{ fields }], typecast: true });
  return guardarPuesto(aPuesto(primero(json)));
}

export async function buscarPuesto(puestoId) {
  const json = await db('Puestos/listRecords', 'POST', { filterByFormula: `{Puesto ID}='${lit(puestoId)}'`, maxRecords: 1 });
  const r = json.records?.[0];
  return r ? guardarPuesto(aPuesto(r)) : null;
}

export async function obtenerPuesto(recId) {
  return guardarPuesto(aPuesto(await db(`Puestos/${recId}`, 'GET')));
}

export async function solicitar(puestoRecId, nivel) {
  const cuerpo = { records: [{ fields: { 'Puesto': [puestoRecId], 'Nivel (%)': nivel, 'Estado': 'Pendiente' } }], typecast: true };
  return conCola('solicitar', { cuerpo }, async () => aSolicitud(primero(await db('Solicitudes', 'POST', cuerpo))));
}

export async function pendientes() {
  const json = await db('Solicitudes/listRecords', 'POST', { filterByFormula: "{Estado}='Pendiente'", sort: [{ field: 'Num', direction: 'asc' }], pageSize: 100 });
  cache.pendientes = json.records.map(aSolicitud);
  return cache.pendientes;
}

// Aviso pendiente de un puesto (se consulta una vez al entrar desde otro teléfono).
export async function solicitudPendienteDe(puestoId) {
  const json = await db('Solicitudes/listRecords', 'POST', {
    filterByFormula: `AND(ARRAYJOIN({Puesto ID})='${lit(puestoId)}', {Estado}='Pendiente')`, maxRecords: 1, fields: ['Puesto ID', 'Estado', 'Creada']
  });
  return json.records[0] ? aSolicitud(json.records[0]) : null;
}

export async function obtenerSolicitud(recId) {
  return aSolicitud(await db(`Solicitudes/${recId}`, 'GET'));
}

export async function atender(solicitudId) {
  const s = aSolicitud(await db(`Solicitudes/${solicitudId}`, 'PATCH', { fields: { 'Estado': 'Atendida' }, typecast: true }));
  if (cache.pendientes) cache.pendientes = cache.pendientes.filter((p) => p.id !== solicitudId);
  return s;
}

function cuerpoRegistro(rec) {
  return {
    records: [{ fields: {
      'Puesto': [rec.puestoRecId], 'Recolector': rec.recolector, 'Lectura cruda HX711': rec.raw,
      'Peso bruto (kg)': rec.brutoKg, 'Tara (kg)': rec.taraKg, 'Densidad (kg/L)': rec.densidad,
      'Turbidez (NTU)': rec.ntu, 'Precio por litro': rec.precio, 'Estado': 'Por confirmar',
      'Fecha de validación': rec.fechaValidacion
    } }],
    typecast: true
  };
}

// rec: { puestoRecId, recolector, raw, brutoKg, taraKg, densidad, ntu, precio, fechaValidacion, solicitudId? }
export async function registrar(rec) {
  const cuerpo = cuerpoRegistro(rec);
  return conCola('registrar', { cuerpo, solicitudId: rec.solicitudId, resumen: rec.resumen }, async () => {
    const r = guardarRec(aRecoleccion(primero(await db('Recolecciones', 'POST', cuerpo))));
    if (rec.solicitudId) await atender(rec.solicitudId).catch((e) => console.error('No se pudo marcar la solicitud como atendida', e));
    return r;
  });
}

export async function obtenerRecoleccion(recId) {
  return guardarRec(aRecoleccion(await db(`Recolecciones/${recId}`, 'GET')));
}

// Nota: se agrega "fields" al cuerpo de listRecords para que la respuesta del comerciante
// sea ligera (< 50 KB aun con 50 recolecciones). No cambia nada en Make ni en Airtable.
const CAMPOS_COMERCIANTE = ['Folio', 'Puesto', 'Puesto ID', 'Nombre del puesto', 'Peso neto (kg)', 'Litros', 'Monto',
  'Agua protegida (L)', 'Biocombustible potencial (L)', 'Estado', 'Fecha de validación', 'Fecha de abono',
  'Segundos al abono', 'Clave de rastreo'];

export async function recoleccionesDe(puestoId) {
  const json = await db('Recolecciones/listRecords', 'POST', {
    filterByFormula: `ARRAYJOIN({Puesto ID})='${lit(puestoId)}'`, sort: [{ field: 'Num', direction: 'desc' }],
    maxRecords: 50, fields: CAMPOS_COMERCIANTE
  });
  return json.records.map(aRecoleccion);
}

export async function rechazar(recId) {
  return guardarRec(aRecoleccion(await db(`Recolecciones/${recId}`, 'PATCH', { fields: { 'Estado': 'Rechazada' }, typecast: true })));
}

export async function pagar(recId, pin, canal) {
  const t0 = performance.now();
  const { status, json, bytes } = await enviar({ accion: 'pagar', recoleccionId: recId, pin, canal });
  const latenciaMs = Math.round(performance.now() - t0);
  if (status === 409) throw new ErrorOleo('conflicto', 'Esta recolección ya fue pagada o el PIN no coincide.', { status });
  if (status === 400) throw new ErrorOleo('accion', json?.error || 'Acción no reconocida.', { status });
  if (!json?.ok) {
    console.error('Respuesta de pago inesperada', status, json);
    throw new ErrorOleo('servidor', 'El pago no se pudo completar. Intenta de nuevo.', { status });
  }
  const pago = { ...json, latenciaMs, bytes };
  cache.pagos.set(recId, pago);
  try { sessionStorage.setItem(`oleo.pago.${recId}`, JSON.stringify(pago)); } catch { /* sin almacenamiento */ }
  cache.recolecciones.delete(recId);
  return pago;
}

// ---------- Asistente (ruta Agente del Escenario A) ----------
// Manda la conversación completa; Make le agrega modelo, instrucciones y herramientas y la reenvía a Claude.
// Devuelve { respuesta, bytes } con el mensaje de la API de Messages tal cual.
const ERRORES_IA = {
  overloaded_error: 'El asistente está saturado. Intenta en un momento.',
  rate_limit_error: 'El asistente recibió demasiados mensajes. Intenta en un momento.',
  authentication_error: 'Falta configurar la API key de Claude en Make.',
  permission_error: 'La API key de Claude en Make no tiene permiso para este modelo.',
  billing_error: 'La cuenta de Claude del equipo no tiene saldo.',
  invalid_request_error: 'La conversación no es válida. Empieza una nueva.',
  request_too_large: 'La conversación es muy larga. Empieza una nueva.'
};

export async function agente(mensajes) {
  const { status, json, bytes } = await enviar({ accion: 'agente', mensajes: JSON.stringify(mensajes) }, { tiempoMs: 60000 });
  if (json?.type === 'error' || (json?.error && typeof json.error === 'object')) {
    console.error(`Claude/Make ${status}`, json.error);
    const tipo = json.error?.type;
    const msg = ERRORES_IA[tipo] || (tipo === 'AIRTABLE_ERROR' ? json.error.message : `El asistente no pudo responder (${tipo || status}).`);
    throw new ErrorOleo('ia', msg, { status, detalle: json.error });
  }
  if (status === 400 && json?.ok === false) {
    throw new ErrorOleo('accion', 'El asistente aún no está configurado en Make (falta la ruta Agente del Escenario A).', { status });
  }
  if (status >= 400 || json?.type !== 'message') {
    console.error('Respuesta inesperada del asistente', status, json);
    throw new ErrorOleo('servidor', `El asistente no pudo responder (${status}).`, { status });
  }
  return { respuesta: json, bytes };
}

export function pagoLocal(recId) {
  if (cache.pagos.has(recId)) return cache.pagos.get(recId);
  try { return JSON.parse(sessionStorage.getItem(`oleo.pago.${recId}`)); } catch { return null; }
}

export async function impacto() {
  const [rs, ps] = await Promise.all([
    db('Recolecciones/listRecords', 'POST', { filterByFormula: "{Estado}='Pagada'", sort: [{ field: 'Num', direction: 'desc' }], pageSize: 100 }),
    db('Puestos/listRecords', 'POST', { fields: ['Puesto ID', 'Alcaldía'], pageSize: 100 })
  ]);
  return { recolecciones: rs.records.map(aRecoleccion), puestos: ps.records.length };
}

// Prueba de conexión de #/config.
export async function probarConexion() {
  const t0 = performance.now();
  const r = await enviar({ accion: 'db', ruta: 'Puestos/listRecords', metodo: 'POST', cuerpo: JSON.stringify({ maxRecords: 1 }) });
  return { ...r, ms: Math.round(performance.now() - t0) };
}

// ---------- Sesión del comerciante ----------
export function sesionPuesto() {
  try { return JSON.parse(localStorage.getItem('oleo.puesto')); } catch { return null; }
}
export function guardarSesion(p) {
  const s = { id: p.id, puestoId: p.puestoId, nombre: p.nombre, pin: p.pin, alcaldia: p.alcaldia, cierre: p.cierre };
  localStorage.setItem('oleo.puesto', JSON.stringify(s));
  return s;
}
export function cerrarSesion() { localStorage.removeItem('oleo.puesto'); localStorage.removeItem('oleo.solicitud'); }

// Solicitud pendiente avisada desde este teléfono: { id, creada }
export function solicitudLocal() {
  try { return JSON.parse(localStorage.getItem('oleo.solicitud')); } catch { return null; }
}
export function guardarSolicitudLocal(s) {
  if (s) localStorage.setItem('oleo.solicitud', JSON.stringify({ id: s.id, creada: s.creada || new Date().toISOString(), pendiente: !!s.pendiente }));
  else localStorage.removeItem('oleo.solicitud');
}

// ---------- Cola offline (sección 8.4) ----------
const CLAVE_COLA = 'oleo.outbox';
const oyentesCola = new Set();
export const alCambiarCola = (fn) => { oyentesCola.add(fn); return () => oyentesCola.delete(fn); };

export function leerCola() {
  try { return JSON.parse(localStorage.getItem(CLAVE_COLA)) || []; } catch { return []; }
}
function escribirCola(items) {
  localStorage.setItem(CLAVE_COLA, JSON.stringify(items));
  oyentesCola.forEach((fn) => fn({ tipo: 'cambio', pendientes: items.length }));
}

const esFallaRed = (e) => e instanceof ErrorOleo && (e.tipo === 'red');

async function conCola(tipo, payload, fn) {
  const sinRed = typeof navigator !== 'undefined' && navigator.onLine === false && modoEfectivo() === 'nube';
  if (!sinRed) {
    try { return await fn(); } catch (e) { if (!esFallaRed(e)) throw e; }
  }
  const item = { id: `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, tipo, payload, intentos: 0, creado: new Date().toISOString() };
  escribirCola([...leerCola(), item]);
  programarCola();
  return { id: item.id, pendiente: true, creada: item.creado };
}

let procesando = false;
let timerCola = null;
export async function procesarCola() {
  if (procesando) return;
  const items = leerCola();
  if (!items.length) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false && modoEfectivo() === 'nube') return;
  procesando = true;
  try {
    for (const item of items) {
      try {
        let resultado;
        if (item.tipo === 'registrar') {
          const r = guardarRec(aRecoleccion(primero(await db('Recolecciones', 'POST', item.payload.cuerpo))));
          if (item.payload.solicitudId) await atender(item.payload.solicitudId).catch((e) => console.error(e));
          resultado = r;
          aviso(`Recolección ${r.folio} enviada.`, 'exito');
        } else if (item.tipo === 'solicitar') {
          resultado = aSolicitud(primero(await db('Solicitudes', 'POST', item.payload.cuerpo)));
          aviso('Aviso de bote lleno enviado.', 'exito');
        }
        escribirCola(leerCola().filter((x) => x.id !== item.id));
        try { sessionStorage.setItem(`oleo.resuelto.${item.id}`, resultado.id); } catch { /* sin almacenamiento */ }
        oyentesCola.forEach((fn) => fn({ tipo: 'enviado', localId: item.id, registro: resultado, item }));
      } catch (e) {
        const cola = leerCola();
        const x = cola.find((c) => c.id === item.id);
        if (x) { x.intentos += 1; x.ultimoError = e.message; escribirCola(cola); }
        if (esFallaRed(e)) break; // sin señal todavía: se reintenta después
        console.error('Error al enviar elemento de la cola', e);
      }
    }
  } finally {
    procesando = false;
    programarCola();
  }
}

export const resueltoDe = (localId) => { try { return sessionStorage.getItem(`oleo.resuelto.${localId}`); } catch { return null; } };

function programarCola() {
  clearTimeout(timerCola);
  if (leerCola().length) timerCola = setTimeout(procesarCola, 20000);
}

export function iniciarCola() {
  window.addEventListener('online', () => procesarCola());
  programarCola();
  if (leerCola().length) setTimeout(procesarCola, 1500);
}
