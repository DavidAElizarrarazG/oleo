// Copia las librerías de terceros desde node_modules a vendor/, minificadas.
// Uso: node herramientas/copiar-vendor.mjs   (requiere npm install)
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(raiz, 'node_modules', p);
const vendor = (p) => join(raiz, 'vendor', p);

async function minificar(origen, destino, cabecera) {
  const codigo = await readFile(origen, 'utf8');
  const r = await minify(codigo, { compress: true, mangle: true, format: { comments: false, preamble: cabecera } });
  await writeFile(destino, r.code + '\n');
  console.log(`${destino.replace(raiz + '/', '')}: ${(codigo.length / 1024).toFixed(1)} KB -> ${(r.code.length / 1024).toFixed(1)} KB`);
}

await mkdir(vendor('leaflet/images'), { recursive: true });
await minificar(nm('qrcode-generator/qrcode.js'), vendor('qrcode.min.js'),
  '/*! qrcode-generator 1.4.4 (c) 2009 Kazuhiko Arase, licencia MIT. https://github.com/kazuhikoarase/qrcode-generator */');
await minificar(nm('jsqr/dist/jsQR.js'), vendor('jsQR.min.js'),
  '/*! jsQR 1.4.0 (c) Cosmo Wolfe, licencia Apache-2.0. https://github.com/cozmo/jsQR */');
await copyFile(nm('leaflet/dist/leaflet.js'), vendor('leaflet/leaflet.js'));
await copyFile(nm('leaflet/dist/leaflet.css'), vendor('leaflet/leaflet.css'));
for (const img of ['layers.png', 'layers-2x.png', 'marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png']) {
  await copyFile(nm(`leaflet/dist/images/${img}`), vendor(`leaflet/images/${img}`));
}
await copyFile(nm('leaflet/LICENSE'), vendor('leaflet/LICENSE'));
console.log('vendor/leaflet: leaflet 1.9.4 (ya viene minificado)');
