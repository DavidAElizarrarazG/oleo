// Arranque: router por hash, layout, barra inferior, indicador de conexión, instalación y service worker.

import { obtenerConfig, modoEfectivo, alCambiarConfig } from './config.js';
import { iniciarCola } from './api.js';
import { $, $$, esc, icono } from './util.js';

// [patrón, módulo, función exportada, tema, sección de la barra]
const RUTAS = [
  ['/', './views/inicio.js', 'default', 'dia', 'inicio'],
  ['/comerciante', './views/comerciante.js', 'miPuesto', 'dia', 'comerciante'],
  ['/comerciante/alta', './views/comerciante.js', 'alta', 'dia', 'comerciante'],
  ['/comerciante/listo', './views/comerciante.js', 'listo', 'dia', 'comerciante'],
  ['/comerciante/entrar', './views/comerciante.js', 'entrar', 'dia', 'comerciante'],
  ['/asistente', './views/asistente.js', 'default', 'dia', 'comerciante'],
  ['/p/:puestoId', './views/comerciante.js', 'destinoQR', 'dia', ''],
  ['/recolector', './views/recolector.js', 'ruta', 'noche', 'recolector'],
  ['/recolector/escanear', './views/recolector.js', 'escanear', 'noche', 'recolector'],
  ['/recolector/pesar/:id', './views/recolector.js', 'pesar', 'noche', 'recolector'],
  ['/recolector/espera/:id', './views/recolector.js', 'espera', 'noche', 'recolector'],
  ['/recolector/pagado/:id', './views/recolector.js', 'pagado', 'noche', 'recolector'],
  ['/constancia/:id', './views/constancia.js', 'default', 'dia', ''],
  ['/impacto', './views/impacto.js', 'default', 'dia', 'impacto'],
  ['/config', './views/ajustes.js', 'default', 'dia', '']
].map(([patron, modulo, fn, tema, seccion]) => {
  const nombres = [];
  const re = new RegExp('^' + patron.replace(/:(\w+)/g, (_, n) => { nombres.push(n); return '([^/]+)'; }) + '/?$');
  return { re, nombres, modulo, fn, tema, seccion };
});

const COLOR_TEMA = { dia: '#1C2427', noche: '#17120C' };

function leerHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [ruta, qs = ''] = h.split('?');
  return { ruta: ruta || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function ir(hash, { reemplazar = false } = {}) {
  if (reemplazar) {
    history.replaceState(null, '', hash);
    renderizar();
  } else if (location.hash === hash) {
    renderizar();
  } else {
    location.hash = hash;
  }
}

let control = null;
async function renderizar() {
  control?.abort();
  control = new AbortController();
  const senal = control.signal;
  const { ruta, query } = leerHash();
  let destino = null;
  let params = {};
  for (const r of RUTAS) {
    const m = ruta.match(r.re);
    if (m) {
      destino = r;
      params = Object.fromEntries(r.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      break;
    }
  }

  const main = $('#principal');
  const raiz = document.createElement('div');
  raiz.className = 'vista';
  main.replaceChildren(raiz);

  const tema = destino?.tema || 'dia';
  document.documentElement.dataset.tema = tema;
  $('meta[name="theme-color"]').setAttribute('content', COLOR_TEMA[tema]);
  $$('.barra a').forEach((a) => {
    if (destino && a.dataset.seccion === destino.seccion) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);

  if (!destino) {
    raiz.innerHTML = `<h1>No encontramos esa pantalla</h1><a class="btn btn-primario" href="#/">Ir al inicio</a>`;
    return;
  }
  raiz.innerHTML = '<p class="cargando">Cargando</p>';
  try {
    const mod = await import(destino.modulo);
    if (senal.aborted) return;
    await mod[destino.fn]({ raiz, params, query, senal, ir });
    if (!senal.aborted) main.focus({ preventScroll: true });
  } catch (e) {
    if (senal.aborted) return;
    console.error(e);
    raiz.innerHTML = `<div class="panel panel-alerta pila">
      <p class="fuerte">No se pudo mostrar esta pantalla.</p>
      <p class="chico">${esc(e.message || e)}</p>
      <button class="btn btn-secundario" id="reintentar-vista">Reintentar</button>
    </div>`;
    $('#reintentar-vista', raiz).addEventListener('click', renderizar);
  }
}

// ---------- Indicador de conexión ----------
function pintarConexion() {
  const el = $('#estado-conexion');
  const local = modoEfectivo() === 'local';
  if (!local && !navigator.onLine) { el.dataset.estado = 'sin-senal'; el.textContent = 'Sin señal'; }
  else if (local) { el.dataset.estado = 'local'; el.textContent = 'Modo local'; }
  else { el.dataset.estado = 'nube'; el.textContent = 'En la nube'; }
}

// ---------- Instalación ----------
let promptInstalar = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptInstalar = e;
  $('#btn-instalar').hidden = false;
});
window.addEventListener('appinstalled', () => { $('#btn-instalar').hidden = true; promptInstalar = null; });

// ---------- Service worker ----------
function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  const habiaControlador = !!navigator.serviceWorker.controller;
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaControlador || recargando) return;
    recargando = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const avisar = (sw) => {
      if (!sw || !navigator.serviceWorker.controller) return;
      $('#banda-version').hidden = false;
      $('#btn-actualizar-version').onclick = () => sw.postMessage({ tipo: 'saltar-espera' });
    };
    if (reg.waiting) avisar(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      nuevo?.addEventListener('statechange', () => { if (nuevo.state === 'installed') avisar(nuevo); });
    });
    // Revisa si hay versión nueva al volver a la app.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch((e) => console.warn('Service worker no registrado', e));
}

// ---------- Arranque ----------
function iniciar() {
  $$('.barra-icono').forEach((s) => { s.innerHTML = icono(s.dataset.icono); });
  $('#btn-instalar').addEventListener('click', async () => {
    if (!promptInstalar) return;
    promptInstalar.prompt();
    await promptInstalar.userChoice.catch(() => {});
    promptInstalar = null;
    $('#btn-instalar').hidden = true;
  });
  obtenerConfig();
  pintarConexion();
  window.addEventListener('online', pintarConexion);
  window.addEventListener('offline', pintarConexion);
  alCambiarConfig(pintarConexion);
  window.addEventListener('hashchange', renderizar);
  iniciarCola();
  renderizar();
  registrarSW();
}

iniciar();
