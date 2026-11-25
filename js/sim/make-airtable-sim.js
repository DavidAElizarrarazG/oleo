// Simulador del contrato Make + Airtable (secciones 6, 7 y 15.1).
// Sin DOM: corre igual en el navegador (modo local, persiste en localStorage) y en Node
// (herramientas/simulador-make.mjs, servidor HTTP para las pruebas E2E).
//
// Reproduce:
//  - Escenario A "OLEO API": router Datos / Pago / Agente / No reconocida, con los mismos filtros, status y cuerpos.
//    La ruta Agente reenvía la conversación a Claude; aquí la atiende un manejador inyectable
//    (por defecto el modelo simulado de js/sim/agente-simulado.js).
//  - Escenario B "API financiera simulada (SPEI/CoDi)".
//  - Airtable: autonumber, created time, fórmulas, lookups, rollups, links inversos, typecast,
//    listRecords (filterByFormula de 8.3, sort, fields, maxRecords, pageSize) y errores 404/422.

import { sha256 } from '../util.js';
import { TIPOS_NEGOCIO } from '../config.js';
import { ALCALDIAS } from '../route.js';
import { generarDatosEjemplo } from './datos-ejemplo.js';
import { manejadorSimulado } from './agente-simulado.js';

export const RUTA_RE = /^(Puestos|Solicitudes|Recolecciones)(\/(rec[A-Za-z0-9]{14}|listRecords))?$/;
export const METODO_RE = /^(GET|POST|PATCH)$/;
const ENCABEZADOS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const CONCEPTO = 'Pago por acopio de aceite vegetal usado';

// ---------- Esquema de Airtable (sección 6) ----------
const EPS = Number.EPSILON;
const ROUND = (x, d = 0) => { const f = 10 ** d; return Math.round((Number(x || 0) + EPS) * f) / f; };
const num = (x) => (x === undefined || x === null || x === '' ? 0 : Number(x));
const pad4 = (n) => ('0000' + n).slice(-4);

const ESQUEMA = {
  Puestos: {
    'Puesto ID': { tipo: 'formula', f: (v) => 'OLEO-' + pad4(v('Num')) },
    'Num': { tipo: 'autonumber' },
    'Nombre del puesto': { tipo: 'texto' },
    'Responsable': { tipo: 'texto' },
    'Tipo de negocio': { tipo: 'select', opciones: TIPOS_NEGOCIO },
    'Alcaldía': { tipo: 'select', opciones: ALCALDIAS.map((a) => a.nombre) },
    'Colonia': { tipo: 'texto' },
    'Cierre': { tipo: 'texto' },
    'WhatsApp': { tipo: 'telefono' },
    'Latitud': { tipo: 'numero', precision: 6 },
    'Longitud': { tipo: 'numero', precision: 6 },
    'PIN': { tipo: 'texto' },
    'Contenedor': { tipo: 'texto' },
    'Alta': { tipo: 'creado' },
    'Solicitudes': { tipo: 'inverso', tabla: 'Solicitudes', campo: 'Puesto' },
    'Recolecciones': { tipo: 'inverso', tabla: 'Recolecciones', campo: 'Puesto' },
    'Litros entregados': { tipo: 'rollup', link: 'Recolecciones', campo: 'Litros pagados' },
    'Pesos ganados': { tipo: 'rollup', link: 'Recolecciones', campo: 'Monto pagado' },
    'Agua protegida (L)': { tipo: 'formula', f: (v) => num(v('Litros entregados')) * 1000 }
  },
  Solicitudes: {
    'Folio solicitud': { tipo: 'formula', f: (v) => 'SOL-' + pad4(v('Num')) },
    'Num': { tipo: 'autonumber' },
    'Puesto': { tipo: 'link', tabla: 'Puestos' },
    'Puesto ID': { tipo: 'lookup', link: 'Puesto', campo: 'Puesto ID' },
    'Nombre del puesto': { tipo: 'lookup', link: 'Puesto', campo: 'Nombre del puesto' },
    'Alcaldía': { tipo: 'lookup', link: 'Puesto', campo: 'Alcaldía' },
    'Cierre': { tipo: 'lookup', link: 'Puesto', campo: 'Cierre' },
    'Latitud': { tipo: 'lookup', link: 'Puesto', campo: 'Latitud' },
    'Longitud': { tipo: 'lookup', link: 'Puesto', campo: 'Longitud' },
    'Nivel (%)': { tipo: 'numero', precision: 0 },
    'Estado': { tipo: 'select', opciones: ['Pendiente', 'Atendida'] },
    'Creada': { tipo: 'creado' }
  },
  Recolecciones: {
    'Folio': { tipo: 'formula', f: (v) => 'REC-' + pad4(v('Num')) },
    'Num': { tipo: 'autonumber' },
    'Puesto': { tipo: 'link', tabla: 'Puestos' },
    'Puesto ID': { tipo: 'lookup', link: 'Puesto', campo: 'Puesto ID' },
    'Nombre del puesto': { tipo: 'lookup', link: 'Puesto', campo: 'Nombre del puesto' },
    'Alcaldía': { tipo: 'lookup', link: 'Puesto', campo: 'Alcaldía' },
    'PIN del puesto': { tipo: 'lookup', link: 'Puesto', campo: 'PIN' },
    'Recolector': { tipo: 'texto' },
    'Lectura cruda HX711': { tipo: 'numero', precision: 0 },
    'Peso bruto (kg)': { tipo: 'numero', precision: 2 },
    'Tara (kg)': { tipo: 'numero', precision: 2 },
    'Peso neto (kg)': { tipo: 'formula', f: (v) => ROUND(Math.max(num(v('Peso bruto (kg)')) - num(v('Tara (kg)')), 0), 2) },
    'Densidad (kg/L)': { tipo: 'numero', precision: 2 },
    'Litros': { tipo: 'formula', f: (v) => (num(v('Densidad (kg/L)')) ? ROUND(num(v('Peso neto (kg)')) / num(v('Densidad (kg/L)')), 2) : { error: '#ERROR!' }) },
    'Turbidez (NTU)': { tipo: 'numero', precision: 1 },
    'Calidad': { tipo: 'formula', f: (v) => (num(v('Turbidez (NTU)')) <= 100 ? 'Aceptado' : 'Revisar') },
    'Precio por litro': { tipo: 'moneda', precision: 2 },
    'Monto': { tipo: 'formula', f: (v) => ROUND(num(v('Litros')) * num(v('Precio por litro')), 2) },
    'Agua protegida (L)': { tipo: 'formula', f: (v) => ROUND(num(v('Litros')) * 1000, 0) },
    'Biocombustible potencial (L)': { tipo: 'formula', f: (v) => ROUND(num(v('Litros')) * 0.9, 2) },
    'Estado': { tipo: 'select', opciones: ['Por confirmar', 'Pagada', 'Rechazada'] },
    'Canal de confirmación': { tipo: 'select', opciones: ['App del comerciante', 'PIN en sitio'] },
    'Fecha de validación': { tipo: 'fecha' },
    'Fecha de abono': { tipo: 'fecha' },
    'Segundos al abono': { tipo: 'formula', f: (v) => (v('Fecha de abono') ? Math.trunc((new Date(v('Fecha de abono')) - new Date(v('Fecha de validación'))) / 1000) : undefined) },
    'Clave de rastreo': { tipo: 'texto' },
    'Constancia (SHA-256)': { tipo: 'texto' },
    'Litros pagados': { tipo: 'formula', f: (v) => (v('Estado') === 'Pagada' ? num(v('Litros')) : 0) },
    'Monto pagado': { tipo: 'formula', f: (v) => (v('Estado') === 'Pagada' ? num(v('Monto')) : 0) }
  }
};
const CALCULADOS = new Set(['formula', 'autonumber', 'creado', 'lookup', 'rollup', 'inverso']);
const vacio = (x) => x === undefined || x === null || x === '' || x === false || (Array.isArray(x) && x.length === 0);

class ErrorAirtable extends Error {
  constructor(status, tipo, mensaje) { super(mensaje); this.status = status; this.tipo = tipo; }
}

// ---------- Utilidades ----------
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function idRegistro() {
  const a = new Uint8Array(14);
  globalThis.crypto.getRandomValues(a);
  return 'rec' + [...a].map((b) => ALFABETO[b % ALFABETO.length]).join('');
}
const p2 = (n) => String(n).padStart(2, '0');
function formatoMake(d, patron) {
  // Solo los dos patrones usados en el Escenario B, en hora local (zona de la organización en Make).
  const off = -d.getTimezoneOffset();
  const zona = `${off >= 0 ? '+' : '-'}${p2(Math.floor(Math.abs(off) / 60))}:${p2(Math.abs(off) % 60)}`;
  const partes = { YYYY: d.getFullYear(), MM: p2(d.getMonth() + 1), DD: p2(d.getDate()), HH: p2(d.getHours()), mm: p2(d.getMinutes()), ss: p2(d.getSeconds()) };
  if (patron === 'YYYYMMDDHHmmss') return `${partes.YYYY}${partes.MM}${partes.DD}${partes.HH}${partes.mm}${partes.ss}`;
  return `${partes.YYYY}-${partes.MM}-${partes.DD}T${partes.HH}:${partes.mm}:${partes.ss}${zona}`;
}
const azar = ([a, b]) => a + Math.random() * (b - a);

// ---------- filterByFormula: {Campo}='v', ARRAYJOIN({Campo})='v' y AND(...) ----------
export function compilarFiltro(formula) {
  let i = 0;
  const s = String(formula || '').trim();
  const error = () => new ErrorAirtable(422, 'INVALID_FILTER_BY_FORMULA', `The formula for filtering records is invalid: ${s}`);
  const ws = () => { while (/\s/.test(s[i])) i++; };
  const lee = (txt) => { ws(); if (s.startsWith(txt, i)) { i += txt.length; return true; } return false; };
  const campo = () => {
    ws();
    if (s[i] !== '{') throw error();
    const fin = s.indexOf('}', i);
    if (fin < 0) throw error();
    const nombre = s.slice(i + 1, fin);
    i = fin + 1;
    return nombre;
  };
  const cadena = () => {
    ws();
    const q = s[i];
    if (q !== "'" && q !== '"') throw error();
    i++;
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; } else out += s[i++];
    }
    if (s[i] !== q) throw error();
    i++;
    return out;
  };
  const expr = () => {
    if (lee('AND(')) {
      const partes = [expr()];
      while (lee(',')) partes.push(expr());
      if (!lee(')')) throw error();
      return (val) => partes.every((p) => p(val));
    }
    let nombre;
    if (lee('ARRAYJOIN(')) { nombre = campo(); if (!lee(')')) throw error(); } else nombre = campo();
    if (!lee('=')) throw error();
    const valor = cadena();
    return (val) => {
      const x = val(nombre);
      const texto = Array.isArray(x) ? x.join(', ') : x === undefined || x === null ? '' : String(x);
      return texto === valor;
    };
  };
  if (!s) return () => true;
  const f = expr();
  ws();
  if (i !== s.length) throw error();
  return f;
}

// ---------- Simulador ----------
export function crearSimulador({
  almacen,                                     // { leer(): db|null, escribir(db) }
  ahora = () => new Date(),
  latencia = { db: [250, 700], pago: [900, 1500] },
  bitacora = () => {},
  agente = manejadorSimulado                   // async (mensajes) => { status, body } como la API de Claude
} = {}) {
  const memoria = { db: null };
  const store = almacen || { leer: () => memoria.db, escribir: (db) => { memoria.db = db; } };

  const nuevaDb = () => ({
    version: 1,
    tablas: { Puestos: [], Solicitudes: [], Recolecciones: [] },
    contadores: { Puestos: 0, Solicitudes: 0, Recolecciones: 0 },
    opciones: {},
    creditos: 0,
    operaciones: { db: 0, pagar: 0, rechazo: 0, fallback: 0, error: 0, spei: 0, agente: 0 }
  });
  const cargar = () => store.leer() || nuevaDb();
  const guardar = (db) => store.escribir(db);

  // ----- Airtable -----
  const buscar = (db, tabla, id) => db.tablas[tabla].find((r) => r.id === id);

  function valor(db, tabla, rec, campo, memo) {
    const k = `${tabla}:${rec.id}:${campo}`;
    if (memo.has(k)) return memo.get(k);
    const def = ESQUEMA[tabla][campo];
    let v;
    if (!def) v = undefined;
    else if (def.tipo === 'autonumber') v = rec.num;
    else if (def.tipo === 'creado') v = rec.createdTime;
    else if (def.tipo === 'formula') v = def.f((c) => valor(db, tabla, rec, c, memo));
    else if (def.tipo === 'inverso') v = db.tablas[def.tabla].filter((r) => (r.fields[def.campo] || []).includes(rec.id)).map((r) => r.id);
    else if (def.tipo === 'lookup' || def.tipo === 'rollup') {
      const defLink = ESQUEMA[tabla][def.link];
      const destino = defLink.tabla;
      const ids = valor(db, tabla, rec, def.link, memo) || [];
      const valores = ids.map((id) => buscar(db, destino, id)).filter(Boolean)
        .flatMap((r) => { const x = valor(db, destino, r, def.campo, memo); return Array.isArray(x) ? x : vacio(x) ? [] : [x]; });
      v = def.tipo === 'lookup' ? valores : valores.reduce((s, n) => s + num(n), 0);
    } else v = rec.fields[campo];
    memo.set(k, v);
    return v;
  }

  function vista(db, tabla, rec, soloCampos) {
    const memo = new Map();
    const fields = {};
    for (const campo of Object.keys(ESQUEMA[tabla])) {
      if (soloCampos && !soloCampos.includes(campo)) continue;
      const v = valor(db, tabla, rec, campo, memo);
      if (!vacio(v)) fields[campo] = v;
    }
    return { id: rec.id, createdTime: rec.createdTime, fields };
  }

  function validarCampos(db, tabla, fields, typecast) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new ErrorAirtable(422, 'INVALID_REQUEST_MISSING_FIELDS', 'Could not find field "fields" in the request body');
    }
    const limpio = {};
    for (const [campo, v] of Object.entries(fields)) {
      const def = ESQUEMA[tabla][campo];
      if (!def) throw new ErrorAirtable(422, 'UNKNOWN_FIELD_NAME', `Unknown field name: "${campo}"`);
      if (CALCULADOS.has(def.tipo)) throw new ErrorAirtable(422, 'INVALID_VALUE_FOR_COLUMN', `Field "${campo}" cannot accept a value because the field is computed`);
      if (v === null || v === undefined || v === '') { limpio[campo] = undefined; continue; }
      const malo = () => new ErrorAirtable(422, 'INVALID_VALUE_FOR_COLUMN', `Field "${campo}" cannot accept the provided value`);
      switch (def.tipo) {
        case 'texto':
        case 'telefono':
          if (typeof v === 'string') limpio[campo] = v;
          else if (typecast && (typeof v === 'number' || typeof v === 'boolean')) limpio[campo] = String(v);
          else throw malo();
          break;
        case 'numero':
        case 'moneda': {
          const n = typeof v === 'number' ? v : typecast && typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
          if (!Number.isFinite(n)) throw malo();
          limpio[campo] = ROUND(n, def.precision);
          break;
        }
        case 'select': {
          if (typeof v !== 'string') throw malo();
          const extra = db.opciones[`${tabla}.${campo}`] || [];
          if (!def.opciones.includes(v) && !extra.includes(v)) {
            if (!typecast) throw new ErrorAirtable(422, 'INVALID_MULTIPLE_CHOICE_OPTIONS', `Insufficient permissions to create new select option ""${v}""`);
            db.opciones[`${tabla}.${campo}`] = [...extra, v];
          }
          limpio[campo] = v;
          break;
        }
        case 'fecha': {
          const d = new Date(v);
          if (typeof v !== 'string' || Number.isNaN(d.getTime())) throw malo();
          limpio[campo] = d.toISOString();
          break;
        }
        case 'link': {
          if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw malo();
          for (const id of v) {
            if (!buscar(db, def.tabla, id)) throw new ErrorAirtable(422, 'ROW_DOES_NOT_EXIST', `Record ID ${id} does not exist in table ${def.tabla}`);
          }
          limpio[campo] = [...new Set(v)];
          break;
        }
        default: throw malo();
      }
    }
    return limpio;
  }

  function aplicar(rec, limpio) {
    for (const [k, v] of Object.entries(limpio)) {
      if (v === undefined) delete rec.fields[k]; else rec.fields[k] = v;
    }
  }

  function crear(db, tabla, fields, typecast) {
    const limpio = validarCampos(db, tabla, fields, typecast);
    db.contadores[tabla] += 1;
    const rec = { id: idRegistro(), num: db.contadores[tabla], createdTime: ahora().toISOString(), fields: {} };
    aplicar(rec, limpio);
    db.tablas[tabla].push(rec);
    return rec;
  }

  function actualizar(db, tabla, id, fields, typecast) {
    const rec = buscar(db, tabla, id);
    if (!rec) throw new ErrorAirtable(404, 'NOT_FOUND', 'Could not find what you are looking for');
    aplicar(rec, validarCampos(db, tabla, fields, typecast));
    return rec;
  }

  function listar(db, tabla, params = {}) {
    const { filterByFormula, sort, fields, maxRecords, pageSize } = params;
    if (fields !== undefined && (!Array.isArray(fields) || fields.some((f) => !ESQUEMA[tabla][f]))) {
      const malo = Array.isArray(fields) ? fields.find((f) => !ESQUEMA[tabla][f]) : fields;
      throw new ErrorAirtable(422, 'UNKNOWN_FIELD_NAME', `Unknown field name: "${malo}"`);
    }
    if (pageSize !== undefined && !(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100)) {
      throw new ErrorAirtable(422, 'INVALID_PAGE_SIZE', 'pageSize must be an integer between 1 and 100');
    }
    const filtro = compilarFiltro(filterByFormula);
    let registros = db.tablas[tabla].filter((rec) => {
      const memo = new Map();
      return filtro((campo) => {
        if (!ESQUEMA[tabla][campo]) throw new ErrorAirtable(422, 'INVALID_FILTER_BY_FORMULA', `Unknown field names: ${campo}`);
        return valor(db, tabla, rec, campo, memo);
      });
    });
    if (sort !== undefined) {
      if (!Array.isArray(sort)) throw new ErrorAirtable(422, 'INVALID_SORT', 'sort must be an array');
      const memo = new Map();
      registros = [...registros].sort((a, b) => {
        for (const { field, direction = 'asc' } of sort) {
          if (!ESQUEMA[tabla][field]) throw new ErrorAirtable(422, 'UNKNOWN_FIELD_NAME', `Unknown field name: "${field}"`);
          const va = valor(db, tabla, a, field, memo);
          const vb = valor(db, tabla, b, field, memo);
          const x = Array.isArray(va) ? va.join(', ') : va ?? '';
          const y = Array.isArray(vb) ? vb.join(', ') : vb ?? '';
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es');
          if (c) return direction === 'desc' ? -c : c;
        }
        return 0;
      });
    }
    if (Number.isInteger(maxRecords) && maxRecords > 0) registros = registros.slice(0, maxRecords);
    const tam = pageSize || 100;
    const pagina = registros.slice(0, tam);
    const r = { records: pagina.map((rec) => vista(db, tabla, rec, fields)) };
    if (registros.length > tam) r.offset = `itr${idRegistro().slice(3)}/${pagina[pagina.length - 1].id}`;
    return r;
  }

  // Petición REST a Airtable: { status, body }
  function airtable(db, metodo, ruta, cuerpoTexto) {
    const [tabla, sub] = ruta.split('/');
    let cuerpo = {};
    if (metodo !== 'GET' && cuerpoTexto) {
      try { cuerpo = JSON.parse(cuerpoTexto); } catch {
        throw new ErrorAirtable(422, 'INVALID_REQUEST_UNKNOWN', 'Invalid request: parameter validation failed. Check your request data.');
      }
    }
    const typecast = cuerpo.typecast === true;
    if (!sub) {
      if (metodo === 'GET') return { status: 200, body: listar(db, tabla, {}) };
      if (metodo === 'POST') {
        if (Array.isArray(cuerpo.records)) {
          if (cuerpo.records.length < 1 || cuerpo.records.length > 10) throw new ErrorAirtable(422, 'INVALID_RECORDS', 'You can create up to 10 records per request');
          const creados = cuerpo.records.map((r) => crear(db, tabla, r.fields, typecast));
          return { status: 200, body: { records: creados.map((r) => vista(db, tabla, r)) } };
        }
        return { status: 200, body: vista(db, tabla, crear(db, tabla, cuerpo.fields, typecast)) };
      }
      if (!Array.isArray(cuerpo.records)) throw new ErrorAirtable(422, 'INVALID_RECORDS', 'Could not find field "records" in the request body');
      const act = cuerpo.records.map((r) => actualizar(db, tabla, r.id, r.fields, typecast));
      return { status: 200, body: { records: act.map((r) => vista(db, tabla, r)) } };
    }
    if (sub === 'listRecords') {
      if (metodo !== 'POST') throw new ErrorAirtable(404, 'NOT_FOUND', 'Could not find what you are looking for');
      return { status: 200, body: listar(db, tabla, cuerpo) };
    }
    if (metodo === 'GET') {
      const rec = buscar(db, tabla, sub);
      if (!rec) throw new ErrorAirtable(404, 'NOT_FOUND', 'Could not find what you are looking for');
      return { status: 200, body: vista(db, tabla, rec) };
    }
    if (metodo === 'PATCH') return { status: 200, body: vista(db, tabla, actualizar(db, tabla, sub, cuerpo.fields, typecast)) };
    throw new ErrorAirtable(404, 'NOT_FOUND', 'Could not find what you are looking for');
  }

  const respuesta = (status, body, encabezados = ENCABEZADOS) => ({ status, headers: { ...encabezados }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const texto = (campos, k) => (campos[k] === undefined || campos[k] === null ? '' : String(campos[k]));

  // ----- Escenario B: API financiera simulada -----
  function liquidar(db, campos) {
    db.creditos += 2;
    db.operaciones.spei += 1;
    const t = ahora();
    const clave = `OLEO${formatoMake(t, 'YYYYMMDDHHmmss')}${Math.floor(Math.random() * 9000) + 1000}`;
    // Se arma como la plantilla de Make: interpolación de texto, sin escapar.
    const body = `{"estatus":"LIQUIDADA","rail":"SPEI","institucion":"STP (simulado)","claveRastreo":"${clave}","monto":${texto(campos, 'monto')},"referencia":"${texto(campos, 'referencia')}","beneficiario":"${texto(campos, 'beneficiario')}","concepto":"${texto(campos, 'concepto')}","fechaOperacion":"${formatoMake(t, 'iso')}"}`;
    return respuesta(200, body);
  }

  async function speiSim(campos = {}) {
    await esperar(azar(latencia.db));
    const db = cargar();
    const r = liquidar(db, campos);
    guardar(db);
    bitacora({ escenario: 'B', accion: 'spei', status: 200, creditos: 2, bytes: r.body.length });
    return r;
  }

  // ----- Escenario A: OLEO API -----
  async function oleoApi(entrada = {}) {
    const campos = Object.fromEntries(Object.entries(entrada).map(([k, v]) => [k, v === undefined || v === null ? '' : String(v)]));
    const { accion, ruta = '', metodo = '' } = campos;
    const esPago = accion === 'pagar';
    await esperar(azar(esPago || accion === 'agente' ? latencia.pago : latencia.db));
    const db = cargar();
    let creditos = 1; // Custom webhook
    let r;
    let detalle;
    let tipo;

    if (accion === 'db' && RUTA_RE.test(ruta) && METODO_RE.test(metodo)) {
      tipo = 'db';
      creditos += 1; // Airtable › Make an API Call
      try {
        const a = airtable(db, metodo, ruta, campos.cuerpo);
        creditos += 2; // JSON › Transform to JSON + Webhook response
        r = respuesta(a.status, a.body);
      } catch (e) {
        if (!(e instanceof ErrorAirtable)) throw e;
        tipo = 'error';
        creditos += 1; // Webhook response del manejador de error
        detalle = { status: e.status, error: { type: e.tipo, message: e.message } };
        r = respuesta(502, { error: { type: 'AIRTABLE_ERROR', message: 'Airtable rechazó la operación. Revisa el historial del escenario.' } });
      }
    } else if (esPago) {
      creditos += 1; // Airtable › Get a record
      const rec = /^rec[A-Za-z0-9]{14}$/.test(campos.recoleccionId) ? buscar(db, 'Recolecciones', campos.recoleccionId) : null;
      if (!rec) {
        // Get a record falla sin manejador: el escenario se detiene antes del Webhook response.
        tipo = 'error';
        detalle = { error: 'Get a record: registro no encontrado' };
        r = { status: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Scenario failed to complete.' };
      } else {
        const memo = new Map();
        const v6 = (c) => valor(db, 'Recolecciones', rec, c, memo);
        const pinPuesto = (v6('PIN del puesto') || []).join('');
        if (v6('Estado') === 'Por confirmar' && pinPuesto === campos.pin) {
          tipo = 'pagar';
          creditos += 1; // HTTP › Make a request
          const b = liquidar(db, { monto: String(v6('Monto')), referencia: v6('Folio'), beneficiario: (v6('Puesto ID') || [])[0], concepto: CONCEPTO });
          const data = JSON.parse(b.body);
          creditos += 1; // Airtable › Update a record
          const sello = await sha256(`${v6('Folio')}|${v6('Litros')}|${v6('Monto')}|${data.claveRastreo}`);
          actualizar(db, 'Recolecciones', rec.id, {
            'Estado': 'Pagada',
            'Canal de confirmación': campos.canal === 'pin' ? 'PIN en sitio' : 'App del comerciante',
            'Fecha de abono': ahora().toISOString(),
            'Clave de rastreo': data.claveRastreo,
            'Constancia (SHA-256)': sello
          }, false);
          const v9 = vista(db, 'Recolecciones', rec).fields;
          creditos += 1; // Webhook response
          r = respuesta(200, `{"ok":true,"recoleccionId":"${rec.id}","folio":"${v9.Folio}","litros":${v9.Litros},"monto":${v9.Monto},"agua":${v9['Agua protegida (L)']},"claveRastreo":"${v9['Clave de rastreo']}","fechaAbono":"${v9['Fecha de abono']}","constancia":"${v9['Constancia (SHA-256)']}","institucion":"${data.institucion}","rail":"${data.rail}"}`);
        } else {
          tipo = 'rechazo';
          creditos += 1;
          r = respuesta(409, { ok: false, error: 'La recolección ya fue pagada o el PIN no coincide.' });
        }
      }
    } else if (accion === 'agente') {
      // HTTP › Make a request a la API de Claude + Webhook response con su respuesta tal cual.
      tipo = 'agente';
      creditos += 2;
      let mensajes = null;
      try { mensajes = JSON.parse(campos.mensajes || ''); } catch { /* JSON inválido: la API responde 400 */ }
      const a = await agente(mensajes);
      r = respuesta(a.status, a.body);
    } else {
      tipo = 'fallback';
      creditos += 1;
      r = respuesta(400, { ok: false, error: 'Acción no reconocida.' });
    }

    db.creditos += creditos;
    db.operaciones[tipo] = (db.operaciones[tipo] || 0) + 1;
    guardar(db);
    bitacora({ escenario: 'A', accion: accion || '(vacía)', ruta, metodo, status: r.status, creditos: creditos + (tipo === 'pagar' ? 2 : 0), bytes: r.body.length, detalle });
    return r;
  }

  // ----- Datos de ejemplo -----
  async function cargarEjemplo(config) {
    const db = cargar();
    const datos = generarDatosEjemplo(ahora(), config);
    const limpiar = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    const puestos = datos.puestos.map((f) => crear(db, 'Puestos', limpiar(f), true));
    for (const s of datos.solicitudes) crear(db, 'Solicitudes', { ...s.fields, Puesto: [puestos[s.puesto].id] }, true);
    for (const r of datos.recolecciones) {
      const rec = crear(db, 'Recolecciones', { ...r.fields, Puesto: [puestos[r.puesto].id] }, true);
      const v = vista(db, 'Recolecciones', rec).fields;
      rec.fields['Constancia (SHA-256)'] = await sha256(`${v.Folio}|${v.Litros}|${v.Monto}|${v['Clave de rastreo']}`);
    }
    guardar(db);
    return { puestos: puestos.length, solicitudes: datos.solicitudes.length, recolecciones: datos.recolecciones.length };
  }

  function esperar(ms) { return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }

  return {
    oleoApi,
    speiSim,
    cargarEjemplo,
    reiniciar() { guardar(nuevaDb()); },
    estado() {
      const db = cargar();
      return {
        creditos: db.creditos,
        operaciones: { ...db.operaciones },
        registros: Object.fromEntries(Object.entries(db.tablas).map(([t, rs]) => [t, rs.length]))
      };
    },
    // Acceso directo para pruebas: registros como los devolvería Airtable.
    listar(tabla, params) { return listar(cargar(), tabla, params).records; },
    set latencia(v) { latencia = v; },
    get latencia() { return latencia; }
  };
}
