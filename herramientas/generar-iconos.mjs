// Genera los íconos PNG de la PWA a partir de icons/icon.svg (usa el Chromium de Playwright).
// Uso: node herramientas/generar-iconos.mjs
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(join(raiz, 'icons/icon.svg'), 'utf8');
// Versión a sangre (sin esquinas redondeadas): iOS y los launchers aplican su propia máscara.
const svgSangre = svg.replace(/<rect width="512" height="512" rx="112"/, '<rect width="512" height="512"');
// Maskable: el contenido dentro de la zona segura (círculo del 80%).
const svgMaskable = svgSangre.replace('scale(2.6)', 'scale(1.95)');

const salidas = [
  ['icons/icon-192.png', svg, 192],
  ['icons/icon-512.png', svg, 512],
  ['icons/icon-maskable-512.png', svgMaskable, 512],
  ['icons/apple-touch-icon-180.png', svgSangre, 180]
];

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
for (const [archivo, fuente, tam] of salidas) {
  await pagina.setViewportSize({ width: tam, height: tam });
  await pagina.setContent(`<html><body style="margin:0;background:transparent">${fuente.replace('<svg ', `<svg width="${tam}" height="${tam}" `)}</body></html>`);
  await pagina.screenshot({ path: join(raiz, archivo), omitBackground: true, clip: { x: 0, y: 0, width: tam, height: tam } });
  console.log(archivo);
}
await navegador.close();
