// QR: generación (qrcode-generator), escaneo (BarcodeDetector o jsQR) y etiqueta PNG del bote (sección 13).

import { cargarScript, vibrar } from './util.js';
import { CONTENEDOR } from './config.js';

// ---------- Contenido ----------
export const baseUrl = () => location.origin + location.pathname;
export const urlPuesto = (puestoId, recId) => `${baseUrl()}#/p/${puestoId}${recId ? `?r=${recId}` : ''}`;

// Acepta la URL del QR del puesto o un texto "OLEO-0007".
export function leerContenido(texto) {
  const t = String(texto || '').trim();
  const url = t.match(/#\/p\/(OLEO-\d{4,})(?:\?(?:.*&)?r=(rec[A-Za-z0-9]{14}))?/i);
  if (url) return { puestoId: url[1].toUpperCase(), recId: url[2] || null };
  const id = t.match(/^(OLEO-\d{4,})$/i);
  if (id) return { puestoId: id[1].toUpperCase(), recId: null };
  return null;
}

// ---------- Generación ----------
async function qrcodeLib() {
  await cargarScript('vendor/qrcode.min.js');
  return window.qrcode;
}

// Matriz de módulos. nivel: L, M, Q o H.
export async function matrizQR(texto, nivel = 'M') {
  const qrcode = await qrcodeLib();
  const qr = qrcode(0, nivel);
  // La librería codifica en Latin-1: se le pasan los bytes UTF-8 ya convertidos.
  qr.addData(unescape(encodeURIComponent(texto)), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return { n, oscuro: (f, c) => qr.isDark(f, c) };
}

export function svgDesdeMatriz({ n, oscuro }, { margen = 4, titulo = 'Código QR' } = {}) {
  const lado = n + margen * 2;
  let d = '';
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n; c++) {
      if (!oscuro(f, c)) continue;
      // Une módulos oscuros consecutivos de la fila en un solo rectángulo.
      let largo = 1;
      while (c + largo < n && oscuro(f, c + largo)) largo++;
      d += `M${c + margen} ${f + margen}h${largo}v1h-${largo}z`;
      c += largo - 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" role="img" aria-label="${titulo}"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export async function qrSVG(texto, { nivel = 'M', margen = 4, titulo } = {}) {
  return svgDesdeMatriz(await matrizQR(texto, nivel), { margen, titulo });
}

function dibujarQR(ctx, { n, oscuro }, x, y, tam) {
  const m = tam / n;
  ctx.fillStyle = '#000';
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n; c++) {
      if (oscuro(f, c)) ctx.fillRect(Math.floor(x + c * m), Math.floor(y + f * m), Math.ceil(m), Math.ceil(m));
    }
  }
}

// ---------- Etiqueta del bote (13.3): 1200 x 1500 px, 10 x 12.5 cm a 300 dpi ----------
export async function etiquetaPNG(puesto) {
  const W = 1200;
  const H = 1500;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const fuente = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `800 120px ${fuente}`;
  ctx.fillText('OLEO', W / 2, 150);
  ctx.font = `500 40px ${fuente}`;
  ctx.fillText('Acopio de aceite vegetal usado', W / 2, 210);

  const matriz = await matrizQR(urlPuesto(puesto.puestoId, puesto.id), 'M');
  const tam = 700;
  const margenQR = tam / matriz.n * 2;
  ctx.fillStyle = '#fff';
  ctx.fillRect((W - tam) / 2 - margenQR, 250 - margenQR, tam + margenQR * 2, tam + margenQR * 2);
  dibujarQR(ctx, matriz, (W - tam) / 2, 270, tam);

  ctx.fillStyle = '#000';
  ctx.font = `800 110px ${fuente}`;
  ctx.fillText(puesto.puestoId, W / 2, 1100);
  ctx.font = `600 54px ${fuente}`;
  ctx.fillText(recortar(ctx, puesto.nombre || '', W - 120), W / 2, 1175);

  ctx.fillRect(80, 1220, W - 160, 4);
  ctx.font = `500 38px ${fuente}`;
  ctx.fillText('Aceite vegetal usado. Mantener tapado.', W / 2, 1290);
  ctx.fillText('Entregar solo a recolector autorizado.', W / 2, 1340);
  ctx.font = `500 34px ${fuente}`;
  ctx.fillText('Referencia: NADF-012-AMBT-2015', W / 2, 1405);
  ctx.fillText(CONTENEDOR, W / 2, 1455);

  return new Promise((ok) => cv.toBlob(ok, 'image/png'));
}

function recortar(ctx, texto, max) {
  if (ctx.measureText(texto).width <= max) return texto;
  let t = texto;
  while (t.length > 1 && ctx.measureText(t + '...').width > max) t = t.slice(0, -1);
  return t + '...';
}

export async function descargarEtiqueta(puesto) {
  const blob = await etiquetaPNG(puesto);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `etiqueta-${puesto.puestoId}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- Escaneo (13.2) ----------
export class Escaner {
  constructor(video, { alLeer, alEstado }) {
    this.video = video;
    this.alLeer = alLeer;
    this.alEstado = alEstado || (() => {});
    this.stream = null;
    this.timer = null;
    this.activo = false;
    this.lienzo = null;
  }

  async iniciar() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('sin-camara');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (this.cancelado) { this.detener(); return; }
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play().catch(() => {});
    this.decodificar = await this.elegirDecodificador();
    this.activo = true;
    this.alEstado('Apunta al QR del bote');
    this.ciclo();
  }

  async elegirDecodificador() {
    if ('BarcodeDetector' in window) {
      try {
        const formatos = await window.BarcodeDetector.getSupportedFormats();
        if (formatos.includes('qr_code')) {
          const det = new window.BarcodeDetector({ formats: ['qr_code'] });
          return async () => (await det.detect(this.video))[0]?.rawValue || null;
        }
      } catch { /* se usa jsQR */ }
    }
    await cargarScript('vendor/jsQR.min.js');
    this.lienzo = document.createElement('canvas');
    const ctx = this.lienzo.getContext('2d', { willReadFrequently: true });
    return async () => {
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      if (!vw || !vh) return null;
      const w = Math.min(640, vw);
      const h = Math.round((vh * w) / vw);
      this.lienzo.width = w;
      this.lienzo.height = h;
      ctx.drawImage(this.video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      return window.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' })?.data || null;
    };
  }

  ciclo() {
    if (!this.activo) return;
    this.timer = setTimeout(async () => {
      if (!this.activo) return;
      let texto = null;
      try { if (this.video.readyState >= 2) texto = await this.decodificar(); } catch { /* cuadro ilegible */ }
      if (!this.activo) return;
      if (texto) {
        vibrar(60);
        this.detener();
        this.alLeer(texto);
        return;
      }
      this.ciclo();
    }, 150);
  }

  detener() {
    this.cancelado = true;
    this.activo = false;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }
}
