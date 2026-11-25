// Pruebas E2E de OLEO (sección 15.2). Requiere: npm install && npx playwright install chromium
// Corre con: npx playwright test   (levanta solos el servidor estático y el simulador de Make)

import { test, expect, chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearSimulador } from '../js/sim/make-airtable-sim.js';
import { derivar, textoSello } from '../js/metrics.js';
import { sha256 } from '../js/util.js';
import { numeroWhatsApp } from '../js/whatsapp.js';
import { plantillaMake, HERRAMIENTAS } from '../js/agente-definicion.js';
import { respuestaSimulada } from '../js/sim/agente-simulado.js';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-generator');
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURAS = join(RAIZ, 'capturas');
const BASE = 'http://localhost:4173/';
const SIM = 'http://localhost:8787';
const HOOK = `${SIM}/hook/oleo-api`;
const UA_MOVIL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

const OPC_CONTEXTO = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false,
  locale: 'es-MX', timezoneId: 'America/Mexico_City', baseURL: BASE, userAgent: UA_MOVIL,
  permissions: ['geolocation', 'camera'], geolocation: { latitude: 19.4326, longitude: -99.1332 }
};
const CONFIG_NUBE = { webhook: HOOK, apiFinanciera: `${SIM}/hook/spei-sim`, pollComercianteMs: 1000, pollComercianteMax: 3, pollRecolectorMs: 1000 };

// ---------- Utilidades ----------
async function contexto(browser, { config = {}, sesion = null, opciones = {} } = {}) {
  const ctx = await browser.newContext({ ...OPC_CONTEXTO, ...opciones });
  await ctx.addInitScript(([c, s]) => {
    localStorage.setItem('oleo.config.v1', JSON.stringify(c));
    if (s && !sessionStorage.getItem('oleo.prueba.sesion')) {
      localStorage.setItem('oleo.puesto', JSON.stringify(s));
      sessionStorage.setItem('oleo.prueba.sesion', '1');
    }
  }, [config, sesion]);
  return ctx;
}

async function capturar(page, nombre) {
  await mkdir(CAPTURAS, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(CAPTURAS, `${nombre}.png`) });
}

async function hook(campos) {
  const r = await fetch(HOOK, { method: 'POST', body: new URLSearchParams(campos) });
  return { status: r.status, json: JSON.parse(await r.text()) };
}
const db = (ruta, metodo, cuerpo) => hook({ accion: 'db', ruta, metodo, cuerpo: cuerpo ? JSON.stringify(cuerpo) : '' });
const reiniciarSim = () => fetch(`${SIM}/__reiniciar`, { method: 'POST' });
const estadoSim = async () => (await fetch(`${SIM}/__estado`)).json();

async function crearPuesto(nombre = 'Fonda de Prueba', pin = '4821') {
  const r = await db('Puestos', 'POST', { records: [{ fields: { 'Nombre del puesto': nombre, 'Tipo de negocio': 'Fonda', 'Alcaldía': 'Cuauhtémoc', 'Cierre': '21:00', 'Latitud': 19.4301, 'Longitud': -99.1452, 'PIN': pin, 'Contenedor': 'Bote hermético 20 L en comodato' } }], typecast: true });
  const rec = r.json.records[0];
  return { id: rec.id, puestoId: rec.fields['Puesto ID'], nombre, pin, alcaldia: 'Cuauhtémoc', cierre: '21:00' };
}

async function crearRecoleccion(puesto, bruto = 14.86) {
  const r = await db('Recolecciones', 'POST', { records: [{ fields: { 'Puesto': [puesto.id], 'Recolector': 'Unidad 01', 'Lectura cruda HX711': 84213 + Math.round(bruto * 21450), 'Peso bruto (kg)': bruto, 'Tara (kg)': 1.2, 'Densidad (kg/L)': 0.91, 'Turbidez (NTU)': 38.2, 'Precio por litro': 3, 'Estado': 'Por confirmar', 'Fecha de validación': new Date().toISOString() } }], typecast: true });
  return r.json.records[0];
}

// Video Y4M (cámara falsa de Chromium) que muestra un QR.
async function videoConQR(texto, archivo) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const W = 640;
  const H = 480;
  const m = Math.floor(420 / (n + 8));
  const lado = m * (n + 8);
  const x0 = Math.floor((W - lado) / 2);
  const y0 = Math.floor((H - lado) / 2);
  const Y = Buffer.alloc(W * H, 120);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const f = Math.floor(y / m) - 4;
      const c = Math.floor(x / m) - 4;
      const oscuro = f >= 0 && c >= 0 && f < n && c < n && qr.isDark(f, c);
      Y[(y0 + y) * W + x0 + x] = oscuro ? 16 : 235;
    }
  }
  const UV = Buffer.alloc((W / 2) * (H / 2), 128);
  const cuadro = Buffer.concat([Buffer.from('FRAME\n'), Y, UV, UV]);
  await writeFile(archivo, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(cuadro)]));
}

function registrarPeticiones(page) {
  const lista = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(SIM)) return;
    const campos = Object.fromEntries(new URLSearchParams(r.postData() || ''));
    lista.push({ metodo: r.method(), tipo: r.headers()['content-type'] || '', accion: campos.accion, ruta: campos.ruta, metodoAirtable: campos.metodo, t: Date.now() });
  });
  return lista;
}

// ---------- T0: contrato del simulador (sin navegador) ----------
test('T0 contrato: fórmulas, sello y respuestas de Make coinciden con el Apéndice C', async () => {
  const sim = crearSimulador({ latencia: { db: [0, 0], pago: [0, 0] } });
  const q = async (campos) => { const r = await sim.oleoApi(campos); return { status: r.status, json: JSON.parse(r.body), headers: r.headers }; };
  const p = await q({ accion: 'db', ruta: 'Puestos', metodo: 'POST', cuerpo: JSON.stringify({ records: [{ fields: { 'Nombre del puesto': 'Tacos El Güero', 'Tipo de negocio': 'Puesto de tacos', 'Alcaldía': 'Cuauhtémoc', 'Cierre': '20:00', 'PIN': '4821' } }], typecast: true }) });
  expect(p.status).toBe(200);
  expect(p.headers['Access-Control-Allow-Origin']).toBe('*');
  const pid = p.json.records[0].id;
  expect(pid).toMatch(/^rec[A-Za-z0-9]{14}$/);
  expect(p.json.records[0].fields['Puesto ID']).toBe('OLEO-0001');

  const r = await q({ accion: 'db', ruta: 'Recolecciones', metodo: 'POST', cuerpo: JSON.stringify({ records: [{ fields: { Puesto: [pid], Recolector: 'Unidad 01', 'Lectura cruda HX711': 402960, 'Peso bruto (kg)': 14.86, 'Tara (kg)': 1.2, 'Densidad (kg/L)': 0.91, 'Turbidez (NTU)': 38.2, 'Precio por litro': 3, Estado: 'Por confirmar', 'Fecha de validación': '2026-10-08T20:41:07.512Z' } }], typecast: true }) });
  const f = r.json.records[0].fields;
  expect(f).toMatchObject({ Folio: 'REC-0001', 'Peso neto (kg)': 13.66, Litros: 15.01, Calidad: 'Aceptado', Monto: 45.03, 'Agua protegida (L)': 15010, 'Biocombustible potencial (L)': 13.51, 'Litros pagados': 0, 'Monto pagado': 0, 'Puesto ID': ['OLEO-0001'], 'PIN del puesto': ['4821'] });
  // metrics.js da lo mismo que las fórmulas de Airtable.
  expect(derivar({ brutoKg: 14.86, taraKg: 1.2, densidad: 0.91, precioLitro: 3, ntu: 38.2, umbral: 100 })).toEqual({ neto: 13.66, litros: 15.01, monto: 45.03, agua: 15010, bio: 13.51, calidad: 'Aceptado' });

  const lista = await q({ accion: 'db', ruta: 'Recolecciones/listRecords', metodo: 'POST', cuerpo: JSON.stringify({ filterByFormula: "AND(ARRAYJOIN({Puesto ID})='OLEO-0001', {Estado}='Por confirmar')", sort: [{ field: 'Num', direction: 'desc' }], maxRecords: 50 }) });
  expect(lista.json.records).toHaveLength(1);

  const pago = await q({ accion: 'pagar', recoleccionId: r.json.records[0].id, pin: '4821', canal: 'pin' });
  expect(pago.status).toBe(200);
  expect(pago.json).toMatchObject({ ok: true, folio: 'REC-0001', litros: 15.01, monto: 45.03, agua: 15010, rail: 'SPEI', institucion: 'STP (simulado)' });
  expect(pago.json.claveRastreo).toMatch(/^OLEO\d{18}$/);
  expect(pago.json.constancia).toBe(await sha256(textoSello('REC-0001', 15.01, 45.03, pago.json.claveRastreo)));

  expect((await q({ accion: 'pagar', recoleccionId: r.json.records[0].id, pin: '4821', canal: 'app' })).status).toBe(409);
  expect((await q({ accion: 'muestra' })).json).toEqual({ ok: false, error: 'Acción no reconocida.' });
  expect((await q({ accion: 'db', ruta: 'Usuarios', metodo: 'GET' })).status).toBe(400);
  const malo = await q({ accion: 'db', ruta: 'Puestos', metodo: 'POST', cuerpo: JSON.stringify({ records: [{ fields: { 'Nombre': 'x' } }] }) });
  expect(malo.status).toBe(502);
  expect(malo.json.error.type).toBe('AIRTABLE_ERROR');
  const puesto = await q({ accion: 'db', ruta: `Puestos/${pid}`, metodo: 'GET' });
  expect(puesto.json.fields).toMatchObject({ 'Litros entregados': 15.01, 'Pesos ganados': 45.03, 'Agua protegida (L)': 15010 });

  // Números de WhatsApp para wa.me
  expect(numeroWhatsApp('55 1234 5678')).toBe('525512345678');
  expect(numeroWhatsApp('+52 1 55 1234 5678')).toBe('5215512345678');
  expect(numeroWhatsApp('1234')).toBe('');

  // Cuerpo del módulo HTTP de Make para la ruta Agente: JSON válido con la píldora en messages.
  const plantilla = plantillaMake();
  expect(plantilla.match(/\{\{/g)).toHaveLength(1);
  const cuerpo = JSON.parse(plantilla.replace('{{1.mensajes}}', '[{"role":"user","content":"Hola"}]'));
  expect(cuerpo).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low' }, fallbacks: 'default', messages: [{ role: 'user', content: 'Hola' }] });
  expect(cuerpo).not.toHaveProperty('thinking');
  expect(cuerpo).not.toHaveProperty('temperature');
  expect(cuerpo.tools.map((t) => t.name)).toEqual(['consultar_mi_puesto', 'avisar_bote_lleno', 'cobrar_recoleccion']);
  for (const t of HERRAMIENTAS) expect(t.input_schema).toMatchObject({ type: 'object', additionalProperties: false });
  expect(cuerpo.system).not.toMatch(/\u2014/);
  // El modelo simulado pide las mismas herramientas.
  const pide = (texto) => respuestaSimulada([{ role: 'user', content: [{ type: 'text', text: texto }] }]).content.find((b) => b.type === 'tool_use')?.name;
  expect(pide('Mi bote ya está lleno')).toBe('avisar_bote_lleno');
  expect(pide('Quiero cobrar')).toBe('cobrar_recoleccion');
  expect(pide('¿Cuánto llevo ganado?')).toBe('consultar_mi_puesto');
});

// ---------- T1: flujo completo en modo local, un solo contexto ----------
test('T1 flujo completo en modo local', async ({ browser }) => {
  const ctx = await contexto(browser, { config: { modo: 'local', pollComercianteMs: 1500, pollRecolectorMs: 1000 } });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tu aceite usado vale dinero.' })).toBeVisible();
  await expect(page.locator('#estado-conexion')).toHaveText('Modo local');

  // Alta
  await page.getByRole('link', { name: 'Registrar mi puesto' }).click();
  await page.getByLabel('Nombre del puesto').fill('Tacos El Güero');
  await page.getByLabel('Tipo de negocio').selectOption('Puesto de tacos');
  await page.getByLabel('Alcaldía').selectOption('Cuauhtémoc');
  await page.getByLabel('Colonia').fill('Doctores');
  await page.getByLabel('WhatsApp').fill('5512345678');
  await page.getByRole('button', { name: 'Registrar mi puesto' }).click();

  // Alta lista
  await expect(page.getByRole('heading', { name: /Tu puesto OLEO-\d{4} quedó registrado\./ })).toBeVisible();
  await expect(page.locator('#qr-puesto svg')).toBeVisible();
  const pin = (await page.locator('#pin').textContent()).trim();
  expect(pin).toMatch(/^\d{4}$/);
  const sesion = await page.evaluate(() => JSON.parse(localStorage.getItem('oleo.puesto')));

  // Mi puesto: aviso de bote lleno
  await page.getByRole('link', { name: 'Ir a mi puesto' }).click();
  await page.locator('#nivel').fill('85');
  await page.getByRole('button', { name: 'Avisar que mi bote está lleno' }).click();
  await expect(page.getByRole('button', { name: 'Ya avisaste; pasamos hoy' })).toBeDisabled();
  await expect(page.locator('#medidor')).toContainText('KB de datos');

  // Recolector: ruta con mapa
  await page.getByRole('navigation').getByRole('link', { name: 'Recolector' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'noche');
  await expect(page.locator('.parada')).toContainText('Tacos El Güero');

  // Escáner (cámara falsa) con respaldo manual
  await page.getByRole('link', { name: 'Escanear QR del bote' }).click();
  await expect(page.getByRole('heading', { name: 'Escanear QR del bote' })).toBeVisible();
  await page.getByLabel('Puesto ID').fill(sesion.puestoId);
  await page.getByRole('button', { name: 'Buscar' }).click();

  // Pesaje con báscula simulada
  await expect(page.getByRole('heading', { name: 'Tacos El Güero' })).toBeVisible();
  await page.getByRole('button', { name: 'Colocar bote en la báscula' }).click();
  await expect(page.locator('#visor')).toHaveAttribute('data-estable', 'si', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Registrar recolección' })).toBeEnabled();
  await expect(page.locator('#visor-crudo')).toContainText('cuentas');
  await page.getByRole('button', { name: 'Registrar recolección' }).click();

  // Espera
  await expect(page.getByRole('heading', { name: /REC-0001 registrada\./ })).toBeVisible();
  const recId = page.url().split('/').pop();
  expect(recId).toMatch(/^rec[A-Za-z0-9]{14}$/);

  // Comerciante: confirma y cobra
  await page.getByRole('navigation').getByRole('link', { name: 'Mi puesto' }).click();
  await expect(page.getByRole('heading', { name: 'Recolección por confirmar' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y cobrar' }).click();
  await expect(page.getByText('Recibiste')).toBeVisible();
  await expect(page.getByText(/Tu confirmación se convirtió en abono en/)).toBeVisible();
  // El aviso quedó atendido: el botón vuelve a estar disponible.
  await expect(page.getByRole('button', { name: 'Avisar que mi bote está lleno' })).toBeEnabled();

  // Constancia con sello verificado
  await page.getByRole('link', { name: 'Ver constancia' }).click();
  await expect(page.getByText('Sello verificado')).toBeVisible();

  // El recolector ve el pago
  await page.goto(`/#/recolector/espera/${recId}`);
  await expect(page.getByRole('heading', { name: 'Abono ejecutado' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Del dato crudo al abono' })).toBeVisible();

  // Tablero actualizado
  await page.getByRole('navigation').getByRole('link', { name: 'Impacto' }).click();
  await expect(page.locator('.indicadores')).toContainText('1');
  const agua = await page.locator('.heroe-agua .cifra').textContent();
  expect(Number(agua.replace(/,/g, ''))).toBeGreaterThan(8000);

  await page.goto('/#/config');
  await expect(page.getByRole('heading', { name: 'Ajustes y diagnóstico' })).toBeVisible();

  expect(errores).toEqual([]);
  await ctx.close();
});

// ---------- T2: dos contextos contra el simulador HTTP, escaneo real por cámara ----------
test('T2 comerciante y recolector contra el simulador HTTP, sin preflight y con sondeo limitado', async ({ browser }, info) => {
  await reiniciarSim();
  const ctxM = await contexto(browser, { config: CONFIG_NUBE });
  const m = await ctxM.newPage();
  const pm = registrarPeticiones(m);

  await m.goto('/#/comerciante/alta');
  await expect(m.locator('#estado-conexion')).toHaveText('En la nube');
  await m.getByLabel('Nombre del puesto').fill('Tacos El Güero');
  await m.getByLabel('Tipo de negocio').selectOption('Puesto de tacos');
  await m.getByLabel('Alcaldía').selectOption('Cuauhtémoc');
  await m.getByLabel('WhatsApp').fill('5512345678');
  await m.getByRole('button', { name: 'Registrar mi puesto' }).click();
  await expect(m.getByRole('heading', { name: /quedó registrado/ })).toBeVisible();
  const sesion = await m.evaluate(() => JSON.parse(localStorage.getItem('oleo.puesto')));

  // Cámara del recolector: video con el QR del puesto.
  const video = join(info.outputDir, 'qr-puesto.y4m');
  await mkdir(info.outputDir, { recursive: true });
  await videoConQR(`${BASE}#/p/${sesion.puestoId}?r=${sesion.id}`, video);
  const navR = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] });
  const ctxR = await contexto(navR, { config: CONFIG_NUBE });
  const r = await ctxR.newPage();
  const pr = registrarPeticiones(r);

  // Comerciante abre Mi puesto y avisa.
  await m.getByRole('link', { name: 'Ir a mi puesto' }).click();
  await m.locator('#nivel').fill('90');
  await m.getByRole('button', { name: 'Avisar que mi bote está lleno' }).click();
  await expect(m.getByRole('button', { name: 'Ya avisaste; pasamos hoy' })).toBeVisible();

  // Recolector: ruta, escaneo con cámara, pesaje, registro.
  await r.goto('/#/recolector');
  await expect(r.locator('.parada')).toContainText('Tacos El Güero');
  await r.getByRole('link', { name: 'Escanear QR del bote' }).click();
  await expect(r.getByRole('heading', { name: 'Tacos El Güero' })).toBeVisible({ timeout: 20000 });
  expect(r.url()).toContain(`/recolector/pesar/${sesion.id}`);
  expect(r.url()).toMatch(/[?&]s=rec/);
  await r.getByRole('button', { name: 'Colocar bote en la báscula' }).click();
  await expect(r.getByRole('button', { name: 'Registrar recolección' })).toBeEnabled({ timeout: 10000 });
  await r.getByRole('button', { name: 'Registrar recolección' }).click();
  await expect(r.getByRole('heading', { name: /REC-0001 registrada\./ })).toBeVisible();

  // Sondeo del comerciante: a lo más 1 + 3 + 3 consultas (al abrir y tras avisar), luego se detiene.
  await m.waitForTimeout(4500);
  const consultasM = () => pm.filter((x) => x.ruta === 'Recolecciones/listRecords').length;
  const antes = consultasM();
  expect(antes).toBeLessThanOrEqual(7);
  await m.waitForTimeout(2500);
  expect(consultasM()).toBe(antes);

  // "Actualizar" trae la recolección por confirmar y el comerciante cobra.
  await m.getByRole('button', { name: 'Actualizar' }).click();
  await expect(m.getByRole('heading', { name: 'Recolección por confirmar' })).toBeVisible();
  await m.getByRole('button', { name: 'Confirmar y cobrar' }).click();
  await expect(m.getByText('Recibiste')).toBeVisible();

  // Pago visible en ambos lados.
  await expect(r.getByRole('heading', { name: 'Abono ejecutado' })).toBeVisible({ timeout: 10000 });

  // Comprobante por WhatsApp al número del dueño, con el mensaje listo.
  await expect(r.locator('#btn-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/525512345678\?text=/);
  await expect(r.locator('#nota-whatsapp')).toContainText('55 1234 5678');
  const mensaje = decodeURIComponent((await r.locator('#btn-whatsapp').getAttribute('href')).split('?text=')[1]);
  expect(mensaje).toContain('Hola, Tacos El Güero.');
  expect(mensaje).toContain('Folio: REC-0001');
  expect(mensaje).toMatch(/Clave de rastreo: OLEO\d{14} \d{4}/);
  expect(mensaje).toContain(`${BASE}#/constancia/rec`);
  const consultasR = pr.filter((x) => x.metodoAirtable === 'GET' && x.ruta?.startsWith('Recolecciones/rec')).length;
  expect(consultasR).toBeLessThanOrEqual(36 + 1);

  // Todo fue form-urlencoded y no hubo ningún preflight.
  for (const x of [...pm, ...pr]) {
    expect(x.metodo).toBe('POST');
    expect(x.tipo).toMatch(/^application\/x-www-form-urlencoded/);
  }
  const est = await estadoSim();
  expect(est.preflights).toBe(0);
  expect(est.operaciones.pagar).toBe(1);
  // La solicitud quedó atendida.
  const sol = await db('Solicitudes/listRecords', 'POST', { filterByFormula: "{Estado}='Pendiente'" });
  expect(sol.json.records).toHaveLength(0);

  await ctxM.close();
  await navR.close();
});

// ---------- T3 y T4: PIN en sitio y segundo intento de pago ----------
test('T3 confirmación con PIN: incorrecto da 409 y correcto paga', async ({ browser }) => {
  await reiniciarSim();
  const puesto = await crearPuesto('Antojitos Lupita', '7314');
  const rec = await crearRecoleccion(puesto);
  const ctx = await contexto(browser, { config: CONFIG_NUBE });
  const r = await ctx.newPage();
  await r.goto(`/#/recolector/espera/${rec.id}`);
  await expect(r.getByRole('heading', { name: /REC-0001 registrada\./ })).toBeVisible();
  await r.getByRole('button', { name: 'Confirmar con PIN' }).click();
  for (const d of '1111') await r.locator(`#teclado [data-d="${d}"]`).click();
  await r.locator('#btn-confirmar-pin').click();
  await expect(r.getByText('Esta recolección ya fue pagada o el PIN no coincide.')).toBeVisible();
  for (const d of '7314') await r.locator(`#teclado [data-d="${d}"]`).click();
  await r.locator('#btn-confirmar-pin').click();
  await expect(r.getByRole('heading', { name: 'Abono ejecutado' })).toBeVisible();
  await expect(r.getByText('Confirmación a abono')).toBeVisible();
  const fila = (await db(`Recolecciones/${rec.id}`, 'GET')).json.fields;
  expect(fila['Canal de confirmación']).toBe('PIN en sitio');
  expect(fila['Estado']).toBe('Pagada');
  await ctx.close();
});

test('T4 segundo intento de pago responde 409', async ({ browser }) => {
  await reiniciarSim();
  const puesto = await crearPuesto();
  const rec = await crearRecoleccion(puesto);
  expect((await hook({ accion: 'pagar', recoleccionId: rec.id, pin: puesto.pin, canal: 'app' })).status).toBe(200);
  const otra = await hook({ accion: 'pagar', recoleccionId: rec.id, pin: puesto.pin, canal: 'app' });
  expect(otra.status).toBe(409);
  expect(otra.json).toEqual({ ok: false, error: 'La recolección ya fue pagada o el PIN no coincide.' });
  // Desde la app del comerciante, el mensaje es claro.
  const ctx = await contexto(browser, { config: CONFIG_NUBE, sesion: puesto });
  const m = await ctx.newPage();
  await m.goto('/#/comerciante');
  const msg = await m.evaluate(async (id) => {
    const api = await import('./js/api.js');
    try { await api.pagar(id, '4821', 'app'); return 'sin error'; } catch (e) { return e.message; }
  }, rec.id);
  expect(msg).toBe('Esta recolección ya fue pagada o el PIN no coincide.');
  await ctx.close();
});

// ---------- T5: cola offline ----------
test('T5 sin red al registrar: queda en la cola y se envía al volver la red', async ({ browser }) => {
  await reiniciarSim();
  const puesto = await crearPuesto();
  const ctx = await contexto(browser, { config: CONFIG_NUBE });
  const r = await ctx.newPage();
  await r.goto(`/#/recolector/pesar/${puesto.id}?p=${puesto.puestoId}`);
  await r.getByRole('button', { name: 'Colocar bote en la báscula' }).click();
  await expect(r.getByRole('button', { name: 'Registrar recolección' })).toBeEnabled({ timeout: 10000 });
  await ctx.setOffline(true);
  await r.getByRole('button', { name: 'Registrar recolección' }).click();
  await expect(r.getByRole('heading', { name: 'Recolección guardada en este teléfono' })).toBeVisible();
  await expect(r.locator('#estado-conexion')).toHaveText('Sin señal');
  expect(await r.evaluate(() => JSON.parse(localStorage.getItem('oleo.outbox')).length)).toBe(1);
  expect((await estadoSim()).registros.Recolecciones).toBe(0);

  await ctx.setOffline(false);
  await expect(r.getByText(/Recolección REC-0001 enviada\./)).toBeVisible({ timeout: 10000 });
  await expect(r.getByRole('heading', { name: /REC-0001 registrada\./ })).toBeVisible();
  expect(r.url()).toMatch(/espera\/rec[A-Za-z0-9]{14}$/);
  expect(await r.evaluate(() => JSON.parse(localStorage.getItem('oleo.outbox')).length)).toBe(0);
  expect((await estadoSim()).registros.Recolecciones).toBe(1);
  await ctx.close();
});

// ---------- T6: calidad "Revisar" ----------
test('T6 lote contaminado: no se puede registrar y rechazarlo no crea registro', async ({ browser }) => {
  await reiniciarSim();
  const puesto = await crearPuesto();
  const ctx = await contexto(browser, { config: CONFIG_NUBE });
  const r = await ctx.newPage();
  await r.goto(`/#/recolector/pesar/${puesto.id}?p=${puesto.puestoId}`);
  await r.getByText('Ajustes de simulación').click();
  await r.getByLabel('Simular lote contaminado').check();
  await r.getByRole('button', { name: 'Colocar bote en la báscula' }).click();
  await expect(r.locator('#visor')).toHaveAttribute('data-estable', 'si', { timeout: 10000 });
  await expect(r.getByText('El lote parece tener agua o sólidos. No se acepta en calle.')).toBeVisible();
  await expect(r.getByRole('button', { name: 'Registrar recolección' })).toBeDisabled();
  await r.getByRole('button', { name: 'Rechazar lote' }).click();
  await expect(r.getByRole('heading', { name: 'Ruta de esta noche' })).toBeVisible();
  expect((await estadoSim()).registros.Recolecciones).toBe(0);
  await ctx.close();
});

// ---------- T7: "No coincide" ----------
test('T7 no coincide: queda Rechazada y el recolector puede volver a pesar', async ({ browser }) => {
  await reiniciarSim();
  const puesto = await crearPuesto();
  const rec = await crearRecoleccion(puesto);
  const ctxR = await contexto(browser, { config: CONFIG_NUBE });
  const r = await ctxR.newPage();
  await r.goto(`/#/recolector/espera/${rec.id}`);
  await expect(r.getByRole('heading', { name: /REC-0001 registrada\./ })).toBeVisible();

  const ctxM = await contexto(browser, { config: CONFIG_NUBE, sesion: puesto });
  const m = await ctxM.newPage();
  await m.goto('/#/comerciante');
  await m.getByRole('button', { name: 'No coincide' }).click();
  await expect(m.getByText('Avisamos al recolector para volver a pesar.')).toBeVisible();
  expect((await db(`Recolecciones/${rec.id}`, 'GET')).json.fields.Estado).toBe('Rechazada');

  await expect(r.getByText('El comerciante indicó que no coincide. Vuelve a pesar.')).toBeVisible({ timeout: 10000 });
  await r.getByRole('link', { name: 'Volver a pesar' }).click();
  await expect(r.getByRole('button', { name: 'Colocar bote en la báscula' })).toBeVisible();
  await ctxR.close();
  await ctxM.close();
});

// ---------- T8: PWA ----------
test('T8 PWA: manifest válido, service worker activo y app shell sin conexión', async ({ browser }) => {
  const ctx = await contexto(browser, { config: { modo: 'local' } });
  const page = await ctx.newPage();
  await page.goto('/');
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'OLEO Acopio de aceite usado', short_name: 'OLEO', lang: 'es-MX', start_url: './', scope: './', display: 'standalone', theme_color: '#1C2427' });
  for (const icono of manifest.icons) {
    const resp = await page.request.get(`/${icono.src}`);
    expect(resp.status()).toBe(200);
    const png = await resp.body();
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    expect(`${w}x${h}`).toBe(icono.sizes);
  }
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);

  // VERSION de sw.js y de config.js coinciden.
  const sw = await readFile(join(RAIZ, 'sw.js'), 'utf8');
  const cfg = await readFile(join(RAIZ, 'js/config.js'), 'utf8');
  expect(sw.match(/VERSION = '([^']+)'/)[1]).toBe(cfg.match(/VERSION = '([^']+)'/)[1]);

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tu aceite usado vale dinero.' })).toBeVisible();
  await page.goto('/#/comerciante/alta');
  await expect(page.getByRole('heading', { name: 'Registrar mi puesto' })).toBeVisible();
  await ctx.close();
});

// ---------- T9: datos del comerciante ----------
test('T9 cada operación del comerciante usa menos de 50 KB, aun con 50 recolecciones', async ({ browser }) => {
  await reiniciarSim();
  const puesto = await crearPuesto();
  for (let lote = 0; lote < 5; lote++) {
    const records = Array.from({ length: 10 }, (_, i) => ({ fields: { 'Puesto': [puesto.id], 'Recolector': 'Unidad 01', 'Lectura cruda HX711': 400000 + i, 'Peso bruto (kg)': 12 + i / 10, 'Tara (kg)': 1.2, 'Densidad (kg/L)': 0.91, 'Turbidez (NTU)': 30, 'Precio por litro': 3, 'Estado': 'Pagada', 'Fecha de validación': new Date().toISOString(), 'Fecha de abono': new Date().toISOString(), 'Clave de rastreo': `OLEO20261008204107${1000 + lote * 10 + i}`, 'Constancia (SHA-256)': 'a'.repeat(64) } }));
    await db('Recolecciones', 'POST', { records, typecast: true });
  }
  await crearRecoleccion(puesto);
  const ctx = await contexto(browser, { config: CONFIG_NUBE, sesion: puesto });
  const m = await ctx.newPage();
  const kb = async () => Number((await m.locator('#medidor').textContent()).match(/([\d.,]+)\s*KB/)[1].replace(',', ''));

  await m.goto('/#/comerciante');
  await expect(m.getByRole('heading', { name: 'Recolección por confirmar' })).toBeVisible();
  await expect(m.locator('#medidor')).toContainText('KB');
  const abrir = await kb();
  expect(abrir).toBeLessThan(50);

  await m.locator('#nivel').fill('85');
  await m.getByRole('button', { name: 'Avisar que mi bote está lleno' }).click();
  await expect(m.getByRole('button', { name: 'Ya avisaste; pasamos hoy' })).toBeVisible();
  expect(await kb()).toBeLessThan(50);

  await m.getByRole('button', { name: 'Confirmar y cobrar' }).click();
  await expect(m.getByText('Recibiste')).toBeVisible();
  const cobrar = await kb();
  expect(cobrar).toBeLessThan(5);
  console.log(`Datos del comerciante: abrir Mi puesto ${abrir} KB con 51 recolecciones; cobrar ${cobrar} KB.`);
  await ctx.close();
});

// ---------- T10: QR ----------
test('T10 el QR del puesto y la etiqueta se decodifican con jsQR al contenido de 13.1', async ({ browser }) => {
  const puesto = { id: 'recA1b2C3d4E5f6G7', puestoId: 'OLEO-0007', nombre: 'Tacos El Güero', pin: '4821', alcaldia: 'Cuauhtémoc', cierre: '20:00' };
  const ctx = await contexto(browser, { config: { modo: 'local' }, sesion: puesto });
  const page = await ctx.newPage();
  await page.goto('/#/comerciante/listo');
  await expect(page.locator('#qr-puesto svg')).toBeVisible();
  const leidos = await page.evaluate(async (p) => {
    await new Promise((ok) => { const s = document.createElement('script'); s.src = 'vendor/jsQR.min.js'; s.onload = ok; document.head.appendChild(s); });
    const decodificar = (fuente, w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx2 = c.getContext('2d');
      ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, w, h);
      ctx2.drawImage(fuente, 0, 0, w, h);
      return window.jsQR(ctx2.getImageData(0, 0, w, h).data, w, h)?.data;
    };
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(document.querySelector('#qr-puesto svg').outerHTML.replace('<svg ', '<svg width="600" height="600" '));
    await img.decode();
    const qr = await import('./js/qr.js');
    const etiqueta = await createImageBitmap(await qr.etiquetaPNG(p));
    return { pantalla: decodificar(img, 600, 600), etiqueta: decodificar(etiqueta, 1200, 1500), esperado: qr.urlPuesto(p.puestoId, p.id) };
  }, puesto);
  expect(leidos.esperado).toBe(`${BASE}#/p/OLEO-0007?r=recA1b2C3d4E5f6G7`);
  expect(leidos.pantalla).toBe(leidos.esperado);
  expect(leidos.etiqueta).toBe(leidos.esperado);
  await ctx.close();
});

// ---------- Capturas para el reporte (sección 15.2): dos teléfonos, transporte "nube" ----------
// Corre contra el simulador HTTP de Make con los datos de ejemplo cargados, así la ruta tiene
// varias paradas y el tablero muestra la semana. Para capturas contra Make real, usa la app desplegada.
test('Capturas en capturas/ (390 x 844, escala 2)', async ({ browser }) => {
  await reiniciarSim();
  await fetch(`${SIM}/__ejemplo`, { method: 'POST' });
  const config = { ...CONFIG_NUBE, pollComercianteMax: 12, pollComercianteMs: 1500 };
  const ctxM = await contexto(browser, { config });
  const ctxR = await contexto(browser, { config });
  const m = await ctxM.newPage();
  const r = await ctxR.newPage();

  await m.goto('/');
  await expect(m.locator('#estado-conexion')).toHaveText('En la nube');
  await capturar(m, '01-inicio');

  await m.getByRole('link', { name: 'Registrar mi puesto' }).click();
  await m.getByLabel('Nombre del puesto').fill('Tacos El Güero');
  await m.getByLabel('Tipo de negocio').selectOption('Puesto de tacos');
  await m.getByLabel('Alcaldía').selectOption('Cuauhtémoc');
  await m.getByLabel('Colonia').fill('Doctores');
  await m.getByLabel('Responsable').fill('Don Güero');
  await m.getByLabel('WhatsApp').fill('5512345678');
  await m.getByLabel('Nombre del puesto').focus();
  await capturar(m, '02-alta');
  await m.getByRole('button', { name: 'Registrar mi puesto' }).click();
  await expect(m.getByRole('heading', { name: /quedó registrado/ })).toBeVisible();
  await expect(m.locator('#qr-puesto svg')).toBeVisible();
  await capturar(m, '03-alta-lista');
  const sesion = await m.evaluate(() => JSON.parse(localStorage.getItem('oleo.puesto')));

  await m.getByRole('link', { name: 'Ir a mi puesto' }).click();
  await m.locator('#nivel').fill('85');
  await m.getByRole('button', { name: 'Avisar que mi bote está lleno' }).click();
  await expect(m.getByRole('button', { name: 'Ya avisaste; pasamos hoy' })).toBeVisible();

  await r.goto('/#/recolector');
  await expect(r.locator('.parada')).toHaveCount(3);
  await r.locator('.leaflet-tile-loaded').first().waitFor({ timeout: 15000 }).catch(() => {});
  await r.waitForTimeout(1500);
  await capturar(r, '06-ruta-mapa');

  await r.getByRole('link', { name: 'Escanear QR del bote' }).click();
  await expect(r.getByText('Apunta al QR del bote')).toBeVisible();
  await r.waitForTimeout(800);
  await capturar(r, '07-escaner');
  await r.getByLabel('Puesto ID').fill(sesion.puestoId);
  await r.getByRole('button', { name: 'Buscar' }).click();
  await expect(r.getByRole('heading', { name: 'Tacos El Güero' })).toBeVisible();
  await r.getByText('Ajustes de simulación').click();
  await r.getByLabel('Peso aleatorio').uncheck();
  await r.locator('#sim-kg').fill('14.86');
  await r.getByText('Ajustes de simulación').click();
  await r.getByRole('button', { name: 'Colocar bote en la báscula' }).click();
  await expect(r.getByRole('button', { name: 'Registrar recolección' })).toBeEnabled({ timeout: 10000 });
  await r.waitForTimeout(600);
  await capturar(r, '08-bascula-estable');
  await r.getByRole('button', { name: 'Registrar recolección' }).click();
  await expect(r.getByRole('heading', { name: /registrada\./ })).toBeVisible();
  await r.waitForTimeout(2200);
  await capturar(r, '09-espera');

  await m.getByRole('button', { name: 'Actualizar' }).click();
  await expect(m.getByRole('heading', { name: 'Recolección por confirmar' })).toBeVisible();
  await capturar(m, '04-mi-puesto-por-confirmar');
  await m.getByRole('button', { name: 'Confirmar y cobrar' }).click();
  await expect(m.getByText('Recibiste')).toBeVisible();
  await capturar(m, '05-cobro-exitoso');

  await expect(r.getByRole('heading', { name: 'Abono ejecutado' })).toBeVisible({ timeout: 10000 });
  await capturar(r, '10-pagado');
  await r.evaluate(() => document.querySelector('#titulo-cadena').scrollIntoView({ block: 'start' }));
  await capturar(r, '11-pagado-trazabilidad');

  await m.getByRole('link', { name: 'Ver constancia' }).click();
  await expect(m.getByText('Sello verificado')).toBeVisible();
  await capturar(m, '12-constancia');
  await m.evaluate(() => document.querySelector('#verificacion').scrollIntoView({ block: 'center' }));
  await capturar(m, '12b-constancia-sello');

  await m.goto('/#/impacto');
  await expect(m.locator('.grafica')).toBeVisible();
  await capturar(m, '13-impacto');
  await m.evaluate(() => document.querySelector('#titulo-grafica').scrollIntoView({ block: 'start' }));
  await capturar(m, '13b-impacto-grafica');

  await m.goto('/#/config');
  await capturar(m, '14-ajustes');

  await ctxM.close();
  await ctxR.close();
});

// ---------- T11 y T12: asistente del comerciante ----------
test('T11 asistente en modo local: avisa, cobra con la tarjeta y consulta el saldo', async ({ browser }) => {
  const ctx = await contexto(browser, { config: { modo: 'local' } });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.goto('/#/comerciante/alta');
  await page.getByLabel('Nombre del puesto').fill('Fonda Doña Tere');
  await page.getByLabel('Tipo de negocio').selectOption('Fonda');
  await page.getByLabel('Alcaldía').selectOption('Iztacalco');
  await page.getByRole('button', { name: 'Registrar mi puesto' }).click();
  await expect(page.getByRole('heading', { name: /quedó registrado/ })).toBeVisible();

  await page.getByRole('link', { name: 'Ir a mi puesto' }).click();
  await page.getByRole('link', { name: 'Preguntarle al asistente' }).click();
  await expect(page.getByText('Modo local: respuestas simuladas, sin IA.')).toBeVisible();

  // Avisar que el bote está lleno
  await page.getByRole('button', { name: 'Mi bote ya está lleno' }).click();
  await expect(page.getByText('Aviso enviado: bote al 100%.')).toBeVisible();
  await expect(page.locator('.burbuja-asistente').last()).toContainText('Pasamos por él hoy entre 20:00 a 24:00');

  // Registrar una recolección (como el recolector) y cobrarla desde el chat
  await page.evaluate(async () => {
    const api = await import('./js/api.js');
    const s = api.sesionPuesto();
    await api.registrar({ puestoRecId: s.id, recolector: 'Unidad 01', raw: 402960, brutoKg: 14.86, taraKg: 1.2, densidad: 0.91, ntu: 38.2, precio: 3, fechaValidacion: new Date().toISOString() });
  });
  await page.getByLabel('Escribe tu mensaje').fill('Quiero cobrar');
  await page.getByRole('button', { name: 'Enviar' }).click();
  const tarjeta = page.locator('.tarjeta-cobro');
  await expect(tarjeta).toContainText('15.01');
  await expect(tarjeta).toContainText('$45.03');
  await tarjeta.getByRole('button', { name: 'Confirmar y cobrar' }).click();
  await expect(tarjeta).toContainText('Recibiste $45.03');
  await expect(page.locator('.burbuja-asistente').last()).toContainText('Recibiste $45.03 por 15.01 L');

  // Saldo
  await page.getByLabel('Escribe tu mensaje').fill('¿Cuánto llevo ganado?');
  await page.getByLabel('Escribe tu mensaje').press('Enter');
  await expect(page.locator('.burbuja-asistente').last()).toContainText('Llevas $45.03 ganados por 15.0 L');
  await expect(page.locator('#medidor')).toContainText('KB de datos');

  // La conversación queda guardada en el teléfono
  await page.reload();
  await expect(page.locator('.burbuja-usuario')).toHaveCount(3);
  await expect(page.locator('.tarjeta-cobro')).toContainText('Recibiste $45.03');
  expect(errores).toEqual([]);
  await ctx.close();
});

test('T12 asistente contra el simulador HTTP: form-urlencoded, sin preflight e historial que solo crece', async ({ browser }) => {
  await reiniciarSim();
  const puesto = await crearPuesto('Tacos Don Chava', '5150');
  await crearRecoleccion(puesto, 12.12);
  const ctx = await contexto(browser, { config: CONFIG_NUBE, sesion: puesto });
  const page = await ctx.newPage();
  const llamadasIA = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(SIM)) return;
    const campos = Object.fromEntries(new URLSearchParams(r.postData() || ''));
    if (campos.accion === 'agente') llamadasIA.push({ tipo: r.headers()['content-type'], mensajes: JSON.parse(campos.mensajes) });
  });

  await page.goto('/#/asistente');
  await expect(page.getByText('Asistente con IA (Claude).')).toBeVisible();
  await page.getByRole('button', { name: '¿Cuánto llevo ganado?' }).click();
  await expect(page.locator('.burbuja-asistente').last()).toContainText('Tienes una recolección por confirmar');
  await page.getByLabel('Escribe tu mensaje').fill('Quiero cobrar');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await page.locator('.tarjeta-cobro').getByRole('button', { name: 'No coincide' }).click();
  await expect(page.locator('.burbuja-asistente').last()).toContainText('vuelva a pesar');
  expect((await db(`Recolecciones/${(await db('Recolecciones/listRecords', 'POST', { maxRecords: 1 })).json.records[0].id}`, 'GET')).json.fields.Estado).toBe('Rechazada');

  // 4 llamadas al modelo: pregunta, resultado de consulta, pedido de cobro, resultado del cobro.
  expect(llamadasIA).toHaveLength(4);
  for (const l of llamadasIA) expect(l.tipo).toMatch(/^application\/x-www-form-urlencoded/);
  for (let i = 1; i < llamadasIA.length; i++) {
    const previo = llamadasIA[i - 1].mensajes;
    expect(llamadasIA[i].mensajes.slice(0, previo.length)).toEqual(previo);
    expect(llamadasIA[i].mensajes.length).toBeGreaterThan(previo.length);
  }
  // Cada tool_use tiene su tool_result en el mensaje siguiente.
  const final = llamadasIA[3].mensajes;
  final.forEach((m, i) => {
    if (m.role !== 'assistant') return;
    for (const uso of m.content.filter((b) => b.type === 'tool_use')) {
      expect(final[i + 1].content.some((b) => b.type === 'tool_result' && b.tool_use_id === uso.id)).toBe(true);
    }
  });
  expect(final[0].content[0].text).toMatch(/^<contexto>Puesto: Tacos Don Chava \(OLEO-0001\)/);
  expect((await estadoSim()).preflights).toBe(0);
  await ctx.close();
});
