// Service worker de OLEO (sección 9.3).
// Cambia VERSION en cada despliegue (y en js/config.js) para que los teléfonos reciban la versión nueva.
const VERSION = '1.2.0';
const CACHE = `oleo-v${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/api.js',
  'js/util.js',
  'js/metrics.js',
  'js/route.js',
  'js/scale.js',
  'js/qr.js',
  'js/whatsapp.js',
  'js/agente.js',
  'js/sim/make-airtable-sim.js',
  'js/sim/datos-ejemplo.js',
  'js/sim/agente-simulado.js',
  'js/views/componentes.js',
  'js/views/inicio.js',
  'js/views/comerciante.js',
  'js/views/recolector.js',
  'js/views/constancia.js',
  'js/views/impacto.js',
  'js/views/ajustes.js',
  'js/views/asistente.js',
  'vendor/qrcode.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter((k) => k.startsWith('oleo-v') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.tipo === 'saltar-espera') self.skipWaiting();
  if (event.data?.tipo === 'version') event.source?.postMessage({ tipo: 'version', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Peticiones a Make (POST, otro origen) y teselas de OpenStreetMap: siempre red, sin caché.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const guardado = await cache.match('index.html');
      const red = fetch(req).then((res) => {
        if (res.ok) cache.put('index.html', res.clone());
        return res;
      }).catch(() => null);
      if (guardado) { event.waitUntil(red); return guardado; }
      return (await red) || new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }

  // Mismo origen: cache-first con actualización en segundo plano.
  // jsQR y Leaflet no están en el precaché: se guardan aquí la primera vez que se usan.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(req, { ignoreSearch: true });
    const red = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (guardado) { event.waitUntil(red); return guardado; }
    return (await red) || Response.error();
  })());
});
