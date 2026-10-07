// QR de la portada del reporte (sección 13.4).
// Uso: node herramientas/qr-portada.mjs https://<usuario>.github.io/oleo/
// Genera capturas/qr-portada.png (2000 x 2000 px, corrección H, margen de 4 módulos) y capturas/qr-portada.svg.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngGris } from './png.mjs';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-generator');
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error('Uso: node herramientas/qr-portada.mjs https://<usuario>.github.io/oleo/');
  process.exit(1);
}

const qr = qrcode(0, 'H');
qr.addData(unescape(encodeURIComponent(url)), 'Byte');
qr.make();
const n = qr.getModuleCount();
const MARGEN = 4;
const total = n + MARGEN * 2;
const LADO = 2000;

const png = pngGris(LADO, LADO, (x, y) => {
  const c = Math.floor((x * total) / LADO) - MARGEN;
  const f = Math.floor((y * total) / LADO) - MARGEN;
  return f >= 0 && c >= 0 && f < n && c < n && qr.isDark(f, c) ? 0 : 255;
});

let d = '';
for (let f = 0; f < n; f++) {
  for (let c = 0; c < n; c++) {
    if (!qr.isDark(f, c)) continue;
    let largo = 1;
    while (c + largo < n && qr.isDark(f, c + largo)) largo++;
    d += `M${c + MARGEN} ${f + MARGEN}h${largo}v1h-${largo}z`;
    c += largo - 1;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${LADO}" height="${LADO}" shape-rendering="crispEdges"><title>${url}</title><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>\n`;

await mkdir(join(raiz, 'capturas'), { recursive: true });
await writeFile(join(raiz, 'capturas/qr-portada.png'), png);
await writeFile(join(raiz, 'capturas/qr-portada.svg'), svg);
console.log(`QR de ${n} x ${n} módulos (corrección H) para ${url}`);
console.log('capturas/qr-portada.png (2000 x 2000 px) y capturas/qr-portada.svg');
