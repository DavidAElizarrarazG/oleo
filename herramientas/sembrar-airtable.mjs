// Carga datos de ejemplo directo en Airtable por API (no gasta créditos de Make), sección 14.1 paso 5:
// 6 puestos inventados, 2 solicitudes pendientes y 10 recolecciones pagadas en los últimos 7 días.
// Uso: AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node herramientas/sembrar-airtable.mjs
// Requiere que los campos manuales (fórmulas, lookups) ya estén configurados.

import { createHash } from 'node:crypto';
import { generarDatosEjemplo } from '../js/sim/datos-ejemplo.js';
import { textoSello } from '../js/metrics.js';

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
if (!TOKEN || !BASE) {
  console.error('Faltan variables de entorno. Uso:\n  AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node herramientas/sembrar-airtable.mjs');
  process.exit(1);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(metodo, tabla, cuerpo) {
  await dormir(250);
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tabla}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo)
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${metodo} ${tabla} respondió ${r.status}: ${JSON.stringify(json.error || json)}`);
  return json;
}
const limpiar = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const lotes = (lista, n = 10) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));

try {
  const datos = generarDatosEjemplo(new Date());

  const puestos = (await api('POST', 'Puestos', { records: datos.puestos.map((f) => ({ fields: limpiar(f) })), typecast: true })).records;
  console.log(`Puestos: ${puestos.map((p) => p.fields['Puesto ID'] || p.id).join(', ')}`);

  await api('POST', 'Solicitudes', { records: datos.solicitudes.map((s) => ({ fields: { ...s.fields, Puesto: [puestos[s.puesto].id] } })), typecast: true });
  console.log(`Solicitudes pendientes: ${datos.solicitudes.length}`);

  const creadas = [];
  for (const lote of lotes(datos.recolecciones)) {
    const r = await api('POST', 'Recolecciones', { records: lote.map((x) => ({ fields: { ...x.fields, Puesto: [puestos[x.puesto].id] } })), typecast: true });
    creadas.push(...r.records);
  }

  // Sello SHA-256 con los valores calculados por Airtable, igual que Make: Folio|Litros|Monto|Clave.
  const sinFormulas = creadas.filter((r) => r.fields.Folio === undefined || r.fields.Litros === undefined || r.fields.Monto === undefined);
  if (sinFormulas.length) {
    console.warn('Las recolecciones se crearon, pero Folio, Litros o Monto no llegaron calculados.');
    console.warn('Configura las fórmulas de la sección 6.3 y vuelve a correr el script en una base limpia para tener sellos válidos.');
  } else {
    const parches = creadas.map((r) => ({
      id: r.id,
      fields: { 'Constancia (SHA-256)': createHash('sha256').update(textoSello(r.fields.Folio, r.fields.Litros, r.fields.Monto, r.fields['Clave de rastreo'])).digest('hex') }
    }));
    for (const lote of lotes(parches)) await api('PATCH', 'Recolecciones', { records: lote });
  }
  console.log(`Recolecciones pagadas: ${creadas.length} (${creadas.map((r) => r.fields.Folio || r.id).join(', ')})`);
  console.log('Listo. Abre el tablero de impacto en la PWA para verlas.');
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
}
