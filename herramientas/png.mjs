// Codificador PNG mínimo (escala de grises de 8 bits) con node:zlib. Sin dependencias.
import { deflateSync } from 'node:zlib';

const TABLA_CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function bloque(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([largo, td, crc]);
}

// pixel(x, y) -> 0..255
export function pngGris(ancho, alto, pixel) {
  const crudo = Buffer.alloc((ancho + 1) * alto);
  for (let y = 0; y < alto; y++) {
    crudo[y * (ancho + 1)] = 0; // filtro "none"
    for (let x = 0; x < ancho; x++) crudo[y * (ancho + 1) + 1 + x] = pixel(x, y);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;  // profundidad
  ihdr[9] = 0;  // escala de grises
  // 10-12: compresión, filtro y entrelazado en 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(crudo, { level: 9 })),
    bloque('IEND', Buffer.alloc(0))
  ]);
}
