// Simulador HTTP de Make + Airtable (sección 15.1). Sin dependencias: node:http y el mismo
// js/sim/make-airtable-sim.js que usa el modo local del navegador.
//
//   node herramientas/simulador-make.mjs [--puerto 8787] [--latencia 250-700] [--latencia-pago 900-1500]
//                                        [--falla-red] [--ejemplo]
//
// Endpoints:
//   POST /hook/oleo-api   Escenario A (OLEO API)
//   POST /hook/spei-sim   Escenario B (API financiera simulada)
//   GET  /__estado        créditos, conteos, peticiones recientes y preflights recibidos (para pruebas)
//   POST /__reiniciar     borra los datos
//   POST /__ejemplo       carga los datos de ejemplo
//   POST /__falla-red?activa=1|0   corta las conexiones (simula falta de red)
//   POST /__latencia?db=250-700&pago=900-1500

import { createServer } from 'node:http';
import { crearSimulador } from '../js/sim/make-airtable-sim.js';

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : porDefecto;
};
const rango = (t, d) => { const [a, b] = String(t || d).split('-').map(Number); return [a, Number.isFinite(b) ? b : a]; };

const puerto = Number(opcion('--puerto', process.env.PUERTO || 8787));
let fallaRed = args.includes('--falla-red');
const silencioso = args.includes('--silencioso');
const peticiones = [];
let preflights = 0;

const sim = crearSimulador({
  latencia: { db: rango(opcion('--latencia'), '250-700'), pago: rango(opcion('--latencia-pago'), '900-1500') },
  bitacora: (e) => {
    if (silencioso) return;
    const ruta = e.ruta ? ` ${e.metodo} ${e.ruta}` : '';
    console.log(`[${new Date().toLocaleTimeString('es-MX')}] Escenario ${e.escenario} ${e.accion}${ruta} -> ${e.status}, ${e.creditos} créditos, ${e.bytes} B${e.detalle ? `, detalle: ${JSON.stringify(e.detalle)}` : ''}`);
  }
});
if (args.includes('--ejemplo')) await sim.cargarEjemplo();

function leerCuerpo(req) {
  return new Promise((ok, mal) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', mal);
  });
}

function responder(res, { status, headers, body }) {
  res.writeHead(status, { ...headers, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const json = (res, status, obj) => responder(res, { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(obj) });

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${puerto}`);
  try {
    // Herramientas de prueba
    if (url.pathname === '/__estado') return json(res, 200, { ...sim.estado(), preflights, peticiones: peticiones.slice(-200), fallaRed });
    if (url.pathname === '/__reiniciar' && req.method === 'POST') { sim.reiniciar(); peticiones.length = 0; preflights = 0; return json(res, 200, { ok: true }); }
    if (url.pathname === '/__ejemplo' && req.method === 'POST') return json(res, 200, await sim.cargarEjemplo());
    if (url.pathname === '/__falla-red' && req.method === 'POST') { fallaRed = url.searchParams.get('activa') !== '0'; return json(res, 200, { fallaRed }); }
    if (url.pathname === '/__latencia' && req.method === 'POST') {
      sim.latencia = { db: rango(url.searchParams.get('db'), '250-700'), pago: rango(url.searchParams.get('pago'), '900-1500') };
      return json(res, 200, sim.latencia);
    }
    if (url.pathname === '/__registros') return json(res, 200, sim.listar(url.searchParams.get('tabla') || 'Recolecciones', {}));

    const esA = url.pathname === '/hook/oleo-api';
    const esB = url.pathname === '/hook/spei-sim';
    if (!esA && !esB) return responder(res, { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'No encontrado' });

    if (fallaRed) { req.socket.destroy(); return; }

    if (req.method === 'OPTIONS') {
      // Un preflight significa que la PWA mandó algo que no es simple request (por ejemplo, JSON).
      preflights++;
      console.warn(`Preflight OPTIONS recibido en ${url.pathname}: la petición no es form-urlencoded.`);
      return responder(res, { status: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method Not Allowed' });
    }
    if (req.method !== 'POST') return responder(res, { status: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method Not Allowed' });

    const tipo = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const cuerpo = await leerCuerpo(req);
    const registro = { t: Date.now(), ruta: url.pathname, contentType: req.headers['content-type'] || '', bytes: Buffer.byteLength(cuerpo) };
    if (tipo !== 'application/x-www-form-urlencoded') {
      peticiones.push({ ...registro, status: 415 });
      return responder(res, { status: 415, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }, body: 'Este simulador solo acepta application/x-www-form-urlencoded.' });
    }
    const campos = Object.fromEntries(new URLSearchParams(cuerpo));
    const r = esA ? await sim.oleoApi(campos) : await sim.speiSim(campos);
    // El Escenario B se configura con Access-Control-Allow-Origin para que "Probar API financiera" lea la respuesta.
    if (esB) r.headers['Access-Control-Allow-Origin'] = '*';
    peticiones.push({ ...registro, accion: campos.accion, rutaAirtable: campos.ruta, metodo: campos.metodo, status: r.status, respuesta: Buffer.byteLength(r.body) });
    responder(res, r);
  } catch (e) {
    console.error(e);
    responder(res, { status: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Scenario failed to complete.' });
  }
});

servidor.listen(puerto, () => {
  console.log(`Simulador de Make en http://localhost:${puerto}`);
  console.log(`  Escenario A: http://localhost:${puerto}/hook/oleo-api`);
  console.log(`  Escenario B: http://localhost:${puerto}/hook/spei-sim`);
});
