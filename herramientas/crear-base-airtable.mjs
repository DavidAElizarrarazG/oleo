// Crea en Airtable las tablas y los campos "script" de la sección 6, y lista los campos "manual".
// Uso:
//   AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node herramientas/crear-base-airtable.mjs
//   ... node herramientas/crear-base-airtable.mjs --verificar   (revisa nombres y tipos, incluidos los manuales)
//   node herramientas/crear-base-airtable.mjs --simular           (muestra lo que haría, sin llamar a Airtable)
//
// El token necesita: data.records:read, data.records:write, schema.bases:read, schema.bases:write.
// Nunca lo subas al repositorio.

import { TIPOS_NEGOCIO } from '../js/config.js';
import { ALCALDIAS } from '../js/route.js';

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const SIMULAR = process.argv.includes('--simular');
const VERIFICAR = process.argv.includes('--verificar');
const API = 'https://api.airtable.com/v0';

const opciones = (lista) => ({ choices: lista.map((name) => ({ name })) });
const fecha = { timeZone: 'utc', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } };

// Campos que crea el script. El primero de cada tabla es el primario: se crea como texto
// y el equipo lo convierte a fórmula (Airtable no permite crear fórmulas por API).
const TABLAS = [
  {
    nombre: 'Puestos',
    campos: [
      { name: 'Puesto ID', type: 'singleLineText', description: 'Convertir a fórmula: "OLEO-" & RIGHT("0000" & {Num}, 4)' },
      { name: 'Nombre del puesto', type: 'singleLineText' },
      { name: 'Responsable', type: 'singleLineText' },
      { name: 'Tipo de negocio', type: 'singleSelect', options: opciones(TIPOS_NEGOCIO) },
      { name: 'Alcaldía', type: 'singleSelect', options: opciones(ALCALDIAS.map((a) => a.nombre)) },
      { name: 'Colonia', type: 'singleLineText' },
      { name: 'Cierre', type: 'singleLineText', description: 'Formato HH:MM' },
      { name: 'WhatsApp', type: 'phoneNumber' },
      { name: 'Latitud', type: 'number', options: { precision: 6 } },
      { name: 'Longitud', type: 'number', options: { precision: 6 } },
      { name: 'PIN', type: 'singleLineText', description: '4 dígitos' },
      { name: 'Contenedor', type: 'singleLineText' }
    ]
  },
  {
    nombre: 'Solicitudes',
    campos: [
      { name: 'Folio solicitud', type: 'singleLineText', description: 'Convertir a fórmula: "SOL-" & RIGHT("0000" & {Num}, 4)' },
      { name: 'Puesto', type: 'multipleRecordLinks', enlace: 'Puestos' },
      { name: 'Nivel (%)', type: 'number', options: { precision: 0 } },
      { name: 'Estado', type: 'singleSelect', options: opciones(['Pendiente', 'Atendida']) }
    ]
  },
  {
    nombre: 'Recolecciones',
    campos: [
      { name: 'Folio', type: 'singleLineText', description: 'Convertir a fórmula: "REC-" & RIGHT("0000" & {Num}, 4)' },
      { name: 'Puesto', type: 'multipleRecordLinks', enlace: 'Puestos' },
      { name: 'Recolector', type: 'singleLineText' },
      { name: 'Lectura cruda HX711', type: 'number', options: { precision: 0 } },
      { name: 'Peso bruto (kg)', type: 'number', options: { precision: 2 } },
      { name: 'Tara (kg)', type: 'number', options: { precision: 2 } },
      { name: 'Densidad (kg/L)', type: 'number', options: { precision: 2 } },
      { name: 'Turbidez (NTU)', type: 'number', options: { precision: 1 } },
      { name: 'Precio por litro', type: 'currency', options: { precision: 2, symbol: '$' } },
      { name: 'Estado', type: 'singleSelect', options: opciones(['Por confirmar', 'Pagada', 'Rechazada']) },
      { name: 'Canal de confirmación', type: 'singleSelect', options: opciones(['App del comerciante', 'PIN en sitio']) },
      { name: 'Fecha de validación', type: 'dateTime', options: fecha },
      { name: 'Fecha de abono', type: 'dateTime', options: fecha },
      { name: 'Clave de rastreo', type: 'singleLineText' },
      { name: 'Constancia (SHA-256)', type: 'singleLineText' }
    ]
  }
];

// Campos que el equipo agrega a mano (sección 6), en el orden recomendado.
// tipo = tipo esperado en la API de Airtable (para --verificar).
export const MANUALES = [
  ['Puestos', 'Num', 'autoNumber', 'Autonumber'],
  ['Puestos', 'Puesto ID', 'formula', 'Convertir el campo primario a Fórmula: "OLEO-" & RIGHT("0000" & {Num}, 4)'],
  ['Puestos', 'Alta', 'createdTime', 'Created time, con hora'],
  ['Solicitudes', 'Num', 'autoNumber', 'Autonumber'],
  ['Solicitudes', 'Folio solicitud', 'formula', 'Convertir el campo primario a Fórmula: "SOL-" & RIGHT("0000" & {Num}, 4)'],
  ['Solicitudes', 'Puesto ID', 'multipleLookupValues', 'Lookup: Puesto -> Puesto ID'],
  ['Solicitudes', 'Nombre del puesto', 'multipleLookupValues', 'Lookup: Puesto -> Nombre del puesto'],
  ['Solicitudes', 'Alcaldía', 'multipleLookupValues', 'Lookup: Puesto -> Alcaldía'],
  ['Solicitudes', 'Cierre', 'multipleLookupValues', 'Lookup: Puesto -> Cierre'],
  ['Solicitudes', 'Latitud', 'multipleLookupValues', 'Lookup: Puesto -> Latitud'],
  ['Solicitudes', 'Longitud', 'multipleLookupValues', 'Lookup: Puesto -> Longitud'],
  ['Solicitudes', 'Creada', 'createdTime', 'Created time, con hora'],
  ['Recolecciones', 'Num', 'autoNumber', 'Autonumber'],
  ['Recolecciones', 'Folio', 'formula', 'Convertir el campo primario a Fórmula: "REC-" & RIGHT("0000" & {Num}, 4)'],
  ['Recolecciones', 'Puesto ID', 'multipleLookupValues', 'Lookup: Puesto -> Puesto ID'],
  ['Recolecciones', 'Nombre del puesto', 'multipleLookupValues', 'Lookup: Puesto -> Nombre del puesto'],
  ['Recolecciones', 'Alcaldía', 'multipleLookupValues', 'Lookup: Puesto -> Alcaldía'],
  ['Recolecciones', 'PIN del puesto', 'multipleLookupValues', 'Lookup: Puesto -> PIN'],
  ['Recolecciones', 'Peso neto (kg)', 'formula', 'Fórmula: ROUND(MAX({Peso bruto (kg)} - {Tara (kg)}, 0), 2)'],
  ['Recolecciones', 'Litros', 'formula', 'Fórmula: ROUND({Peso neto (kg)} / {Densidad (kg/L)}, 2)'],
  ['Recolecciones', 'Calidad', 'formula', 'Fórmula: IF({Turbidez (NTU)} <= 100, "Aceptado", "Revisar")'],
  ['Recolecciones', 'Monto', 'formula', 'Fórmula: ROUND({Litros} * {Precio por litro}, 2)  (formato moneda)'],
  ['Recolecciones', 'Agua protegida (L)', 'formula', 'Fórmula: ROUND({Litros} * 1000, 0)'],
  ['Recolecciones', 'Biocombustible potencial (L)', 'formula', 'Fórmula: ROUND({Litros} * 0.9, 2)'],
  ['Recolecciones', 'Segundos al abono', 'formula', "Fórmula: IF({Fecha de abono}, DATETIME_DIFF({Fecha de abono}, {Fecha de validación}, 'seconds'))"],
  ['Recolecciones', 'Litros pagados', 'formula', 'Fórmula: IF({Estado} = "Pagada", {Litros}, 0)'],
  ['Recolecciones', 'Monto pagado', 'formula', 'Fórmula: IF({Estado} = "Pagada", {Monto}, 0)'],
  ['Puestos', 'Litros entregados', 'rollup', 'Rollup: Recolecciones -> Litros pagados, SUM(values)'],
  ['Puestos', 'Pesos ganados', 'rollup', 'Rollup: Recolecciones -> Monto pagado, SUM(values), formato moneda'],
  ['Puestos', 'Agua protegida (L)', 'formula', 'Fórmula: {Litros entregados} * 1000']
];
const INVERSOS = [['Puestos', 'Solicitudes', 'multipleRecordLinks'], ['Puestos', 'Recolecciones', 'multipleRecordLinks']];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function airtable(metodo, ruta, cuerpo) {
  if (SIMULAR) {
    console.log(`[simular] ${metodo} ${ruta}${cuerpo ? `\n${JSON.stringify(cuerpo, null, 2)}` : ''}`);
    return metodo === 'GET' ? { tables: [] } : { id: `tbl${ruta.length}simulada`, fields: [] };
  }
  await dormir(250); // límite de 5 peticiones por segundo
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const texto = await r.text();
  let json;
  try { json = JSON.parse(texto); } catch { json = { texto }; }
  if (!r.ok) {
    const e = new Error(`${metodo} ${ruta} respondió ${r.status}: ${JSON.stringify(json.error || json)}`);
    e.status = r.status;
    throw e;
  }
  return json;
}

function campoParaApi(c, ids) {
  const { enlace, ...campo } = c;
  if (enlace) campo.options = { linkedTableId: ids[enlace], prefersSingleRecordLink: true };
  return campo;
}

async function crearCampo(tablaId, campo) {
  try {
    return await airtable('POST', `/meta/bases/${BASE}/tables/${tablaId}/fields`, campo);
  } catch (e) {
    // Algunas versiones de la API no aceptan prefersSingleRecordLink al crear: se reintenta sin él.
    if (campo.type === 'multipleRecordLinks' && e.status === 422 && campo.options?.prefersSingleRecordLink) {
      const { prefersSingleRecordLink, ...resto } = campo.options;
      console.log(`   (reintento sin prefersSingleRecordLink; márcalo a mano: "Allow linking to multiple records" apagado)`);
      return airtable('POST', `/meta/bases/${BASE}/tables/${tablaId}/fields`, { ...campo, options: resto });
    }
    throw e;
  }
}

async function crearTabla(t, ids) {
  const cuerpo = { name: t.nombre, fields: t.campos.map((c) => campoParaApi(c, ids)) };
  try {
    return await airtable('POST', `/meta/bases/${BASE}/tables`, cuerpo);
  } catch (e) {
    if (e.status === 422 && t.campos.some((c) => c.enlace)) {
      console.log('   (reintento creando los links después)');
      const sinLinks = { name: t.nombre, fields: t.campos.filter((c) => !c.enlace).map((c) => campoParaApi(c, ids)) };
      const tabla = await airtable('POST', `/meta/bases/${BASE}/tables`, sinLinks);
      for (const c of t.campos.filter((x) => x.enlace)) await crearCampo(tabla.id, campoParaApi(c, ids));
      return tabla;
    }
    throw e;
  }
}

async function crear() {
  const { tables } = await airtable('GET', `/meta/bases/${BASE}/tables`);
  const existentes = new Map(tables.map((t) => [t.name, t]));
  const ids = Object.fromEntries(tables.map((t) => [t.name, t.id]));

  for (const t of TABLAS) {
    const actual = existentes.get(t.nombre);
    if (!actual) {
      console.log(`Creando tabla ${t.nombre} con ${t.campos.length} campos`);
      const tabla = await crearTabla(t, ids);
      ids[t.nombre] = tabla.id;
      continue;
    }
    ids[t.nombre] = actual.id;
    const nombres = new Set(actual.fields.map((f) => f.name));
    const faltan = t.campos.filter((c) => !nombres.has(c.name));
    console.log(`Tabla ${t.nombre} ya existe: ${faltan.length ? `agregando ${faltan.map((c) => c.name).join(', ')}` : 'campos de script completos'}`);
    for (const c of faltan) {
      if (c === t.campos[0]) { console.log(`   El primario de ${t.nombre} debe llamarse "${c.name}". Renómbralo a mano.`); continue; }
      await crearCampo(actual.id, campoParaApi(c, ids));
    }
  }

  if (tables.some((t) => !TABLAS.some((x) => x.nombre === t.name))) {
    console.log(`\nLa base tiene otras tablas (${tables.filter((t) => !TABLAS.some((x) => x.nombre === t.name)).map((t) => t.name).join(', ')}). Bórralas a mano si son la "Table 1" vacía que crea Airtable.`);
  }

  console.log('\nListo. Ahora agrega a mano estos campos, en este orden (sección 6):');
  let tablaPrevia = '';
  MANUALES.forEach(([tabla, campo, , instruccion], i) => {
    if (tabla !== tablaPrevia) { console.log(`\n  ${tabla}`); tablaPrevia = tabla; }
    console.log(`  ${String(i + 1).padStart(2)}. ${campo}: ${instruccion}`);
  });
  console.log('\nAl terminar, corre: node herramientas/crear-base-airtable.mjs --verificar');
}

async function verificar() {
  const { tables } = await airtable('GET', `/meta/bases/${BASE}/tables`);
  const porNombre = new Map(tables.map((t) => [t.name, t]));
  const problemas = [];
  const revisar = (tabla, campo, tipo) => {
    const t = porNombre.get(tabla);
    if (!t) { problemas.push(`Falta la tabla ${tabla}`); return; }
    const f = t.fields.find((x) => x.name === campo);
    if (!f) problemas.push(`${tabla}: falta el campo "${campo}"`);
    else if (tipo && f.type !== tipo) problemas.push(`${tabla}: "${campo}" es ${f.type}, se esperaba ${tipo}`);
  };
  for (const t of TABLAS) for (const c of t.campos.slice(1)) revisar(t.nombre, c.name, c.type);
  for (const [tabla, campo, tipo] of MANUALES) revisar(tabla, campo, tipo);
  for (const [tabla, campo, tipo] of INVERSOS) revisar(tabla, campo, tipo);
  for (const [tabla, primario] of [['Puestos', 'Puesto ID'], ['Solicitudes', 'Folio solicitud'], ['Recolecciones', 'Folio']]) {
    const t = porNombre.get(tabla);
    const p = t?.fields.find((f) => f.id === t.primaryFieldId);
    if (t && p?.name !== primario) problemas.push(`${tabla}: el campo primario es "${p?.name}", debe ser "${primario}"`);
  }
  for (const [tabla, campo] of [['Solicitudes', 'Puesto'], ['Recolecciones', 'Puesto']]) {
    const f = porNombre.get(tabla)?.fields.find((x) => x.name === campo);
    if (f?.options && f.options.prefersSingleRecordLink === false) problemas.push(`${tabla}: "${campo}" permite varios registros; apaga "Allow linking to multiple records"`);
  }
  if (problemas.length) {
    console.log(`Se encontraron ${problemas.length} pendientes:\n- ${problemas.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('La base OLEO coincide con el contrato de la sección 6.');
  }
}

if (!SIMULAR && (!TOKEN || !BASE)) {
  console.error('Faltan variables de entorno. Uso:\n  AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node herramientas/crear-base-airtable.mjs');
  process.exit(1);
}
if (BASE && !/^app[A-Za-z0-9]{14}$/.test(BASE)) console.warn(`Aviso: el BASE_ID "${BASE}" no parece válido (empieza con app y tiene 17 caracteres).`);

try {
  if (VERIFICAR) await verificar(); else await crear();
} catch (e) {
  console.error(`\nError: ${e.message}`);
  if (e.status === 401 || e.status === 403) console.error('Revisa el token y que tenga acceso a la base OLEO con los 4 scopes.');
  process.exitCode = 1;
}
