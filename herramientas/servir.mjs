// Servidor estático mínimo para desarrollo y pruebas (sin dependencias).
// Uso: node herramientas/servir.mjs [--puerto 4173]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const puerto = Number(args[args.indexOf('--puerto') + 1]) || Number(process.env.PUERTO) || 4173;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

createServer(async (req, res) => {
  try {
    let ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (ruta.endsWith('/')) ruta += 'index.html';
    const archivo = normalize(join(raiz, ruta));
    if (!archivo.startsWith(raiz) || /node_modules|\/\.git\//.test(archivo)) { res.writeHead(403).end(); return; }
    const info = await stat(archivo);
    if (!info.isFile()) throw new Error('no es archivo');
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(archivo));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}).listen(puerto, () => console.log(`OLEO en http://localhost:${puerto}/`));
