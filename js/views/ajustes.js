// Ajustes y diagnóstico (#/config, sección 10.11).

import * as api from '../api.js';
import { DEFAULTS, VERSION, obtenerConfig, guardarConfig, restablecerConfig, modoEfectivo } from '../config.js';
import { $, esc, fmtKB, fmtNum, aviso, confirmar, bytesUtf8 } from '../util.js';

const CAMPOS = [
  ['webhook', 'URL del webhook del Escenario A (OLEO API)', 'url', 'Vacía = modo local.'],
  ['apiFinanciera', 'URL del Escenario B (API financiera simulada)', 'url', 'Solo para el botón de prueba.'],
  ['precioLitro', 'Precio por litro (MXN)', 'number', '', '0.01'],
  ['taraKg', 'Tara del bote (kg)', 'number', '', '0.01'],
  ['densidad', 'Densidad del aceite (kg/L)', 'number', '', '0.01'],
  ['umbralNTU', 'Turbidez máxima aceptada (NTU)', 'number', 'Debe coincidir con la fórmula Calidad de Airtable.', '1'],
  ['recolector', 'Nombre de la unidad', 'text'],
  ['ventana', 'Ventana de la ruta', 'text'],
  ['pollComercianteMs', 'Sondeo del comerciante (ms)', 'number', '', '500'],
  ['pollComercianteMax', 'Máximo de consultas del comerciante', 'number', '', '1'],
  ['pollRecolectorMs', 'Sondeo del recolector (ms)', 'number', '', '500'],
  ['pollRecolectorMax', 'Máximo de consultas del recolector', 'number', '', '1'],
  ['impactoAutoMs', 'Refresco automático del tablero (ms, 0 = apagado)', 'number', '', '1000']
];

const MUESTRA_A = { accion: 'muestra', ruta: 'Puestos/listRecords', metodo: 'POST', cuerpo: '{}', recoleccionId: 'rec00000000000000', pin: '0000', canal: 'app', mensajes: '[]' };
const MUESTRA_B = { monto: '45.03', referencia: 'REC-0000', beneficiario: 'OLEO-0000', concepto: 'Prueba' };

export default async function ajustes({ raiz }) {
  function pintar() {
    const c = obtenerConfig();
    const local = modoEfectivo(c) === 'local';
    const cola = api.leerCola();
    const sesion = api.sesionPuesto();
    raiz.innerHTML = `
      <div class="encabezado">
        <h1>Ajustes y diagnóstico</h1>
        <p class="secundario">Modo actual: <strong>${local ? 'local (solo en este teléfono)' : 'nube (Make + Airtable)'}</strong></p>
      </div>

      <form id="form-config" class="pila" novalidate>
        <div class="campo">
          <label for="c-modo">Modo</label>
          <select id="c-modo" name="modo">
            <option value="nube" ${c.modo === 'nube' ? 'selected' : ''}>Nube (Make + Airtable)</option>
            <option value="local" ${c.modo === 'local' ? 'selected' : ''}>Local (simulador en el navegador)</option>
          </select>
        </div>
        ${CAMPOS.map(([k, rotulo, tipo, ayuda = '', paso]) => `<div class="campo">
          <label for="c-${k}">${esc(rotulo)}</label>
          <input id="c-${k}" name="${k}" type="${tipo}" ${paso ? `step="${paso}"` : ''} ${tipo === 'url' ? 'inputmode="url" autocomplete="off" spellcheck="false"' : ''} value="${esc(c[k])}" placeholder="${esc(DEFAULTS[k])}">
          ${ayuda ? `<span class="ayuda">${esc(ayuda)}</span>` : ''}
        </div>`).join('')}
        <div class="dos">
          <button class="btn btn-primario" type="submit">Guardar</button>
          <button class="btn btn-secundario" type="button" id="btn-restablecer">Restablecer</button>
        </div>
      </form>

      <section class="seccion" aria-labelledby="titulo-diag">
        <h2 id="titulo-diag">Diagnóstico</h2>
        <button class="btn btn-secundario" id="btn-probar">Probar conexión</button>
        <button class="btn btn-secundario" id="btn-muestra">Enviar muestra al webhook</button>
        <button class="btn btn-secundario" id="btn-spei">Probar API financiera</button>
        <button class="btn btn-secundario" id="btn-ia">Probar asistente</button>
        <p class="nota">"Probar asistente" manda un mensaje a Claude: gasta unos 4 créditos de Make y centavos de la API.</p>
        <pre class="panel chico mono" id="salida" style="white-space:pre-wrap;word-break:break-all;margin:0" hidden></pre>
      </section>

      ${local ? `<section class="seccion" aria-labelledby="titulo-local">
        <h2 id="titulo-local">Datos locales</h2>
        <p class="chico secundario" id="estado-sim"></p>
        <button class="btn btn-secundario" id="btn-ejemplo">Cargar datos de ejemplo</button>
        <button class="btn btn-peligro" id="btn-borrar">Borrar datos locales</button>
      </section>` : ''}

      <section class="seccion" aria-labelledby="titulo-cola">
        <h2 id="titulo-cola">Cola offline</h2>
        <p>${cola.length ? `${cola.length} ${cola.length === 1 ? 'operación pendiente' : 'operaciones pendientes'} de enviar.` : 'Sin pendientes.'}</p>
        ${cola.length ? `<ul class="lista chico">${cola.map((x) => `<li>${esc(x.tipo)}, ${esc(new Date(x.creado).toLocaleTimeString('es-MX'))}, ${x.intentos} intentos${x.ultimoError ? `. ${esc(x.ultimoError)}` : ''}</li>`).join('')}</ul>
        <button class="btn btn-secundario" id="btn-enviar-cola">Enviar ahora</button>` : ''}
      </section>

      <section class="seccion" aria-labelledby="titulo-sesion">
        <h2 id="titulo-sesion">Sesión del puesto en este teléfono</h2>
        <p>${sesion ? `${esc(sesion.nombre)}, ${esc(sesion.puestoId)}` : 'Ninguna.'}</p>
        ${sesion ? '<button class="btn btn-secundario" id="btn-cerrar-sesion">Cerrar sesión del puesto</button>' : ''}
      </section>

      <footer class="pie chico secundario">
        <span>OLEO v${VERSION}</span>
        <span id="estado-sw"></span>
      </footer>`;
    enlazar(c, local);
  }

  const salida = (texto) => { const s = $('#salida', raiz); s.hidden = false; s.textContent = texto; };

  function enlazar(c, local) {
    $('#form-config', raiz).addEventListener('submit', (e) => {
      e.preventDefault();
      guardarConfig(Object.fromEntries(new FormData(e.target)));
      aviso('Ajustes guardados.', 'exito');
      pintar();
    });
    $('#btn-restablecer', raiz).addEventListener('click', () => { restablecerConfig(); aviso('Ajustes restablecidos.'); pintar(); });

    $('#btn-probar', raiz).addEventListener('click', async () => {
      salida('Probando conexión');
      try {
        const r = await api.probarConexion();
        salida(`Status ${r.status} en ${fmtNum(r.ms)} ms, ${fmtKB(r.bytes)}.\n${JSON.stringify(r.json).slice(0, 400)}`);
      } catch (e) { salida(`Error: ${e.message}`); }
    });

    $('#btn-muestra', raiz).addEventListener('click', async () => {
      if (local) {
        const sim = await api.obtenerSimulador();
        const r = await sim.oleoApi(MUESTRA_A);
        salida(`Simulador local: status ${r.status}. ${r.body}\nEn Make, esta muestra sirve para que el webhook aprenda los campos (Redetermine data structure).`);
        return;
      }
      await probarUrl(c.webhook, MUESTRA_A, 'webhook del Escenario A');
    });

    $('#btn-spei', raiz).addEventListener('click', async () => {
      if (local || !c.apiFinanciera) {
        if (!local) { salida('Falta la URL del Escenario B.'); return; }
        const sim = await api.obtenerSimulador();
        const r = await sim.speiSim(MUESTRA_B);
        salida(`Simulador local: status ${r.status}.\n${r.body}`);
        return;
      }
      await probarUrl(c.apiFinanciera, MUESTRA_B, 'Escenario B');
    });

    $('#btn-ia', raiz).addEventListener('click', async () => {
      salida('Probando el asistente');
      const t0 = performance.now();
      try {
        const { respuesta, bytes } = await api.agente([{ role: 'user', content: 'Hola, ¿en qué me puedes ayudar? Responde en una frase.' }]);
        const texto = (respuesta.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ');
        salida(`Respondió ${respuesta.model} en ${fmtNum(performance.now() - t0)} ms, ${fmtKB(bytes)} (stop_reason: ${respuesta.stop_reason}).\n${texto}`);
      } catch (e) { salida(`Error: ${e.message}`); }
    });

    $('#btn-ejemplo', raiz)?.addEventListener('click', async () => {
      const sim = await api.obtenerSimulador();
      const r = await sim.cargarEjemplo(obtenerConfig());
      api.cache.pendientes = null;
      aviso(`Listo: ${r.puestos} puestos, ${r.solicitudes} solicitudes y ${r.recolecciones} recolecciones de ejemplo.`, 'exito');
      pintarSim();
    });
    $('#btn-borrar', raiz)?.addEventListener('click', async () => {
      if (!(await confirmar('Se borran los datos del simulador, la sesión del puesto y la cola offline de este teléfono. ¿Continuar?', { aceptar: 'Sí, borrar' }))) return;
      for (const k of ['oleo.sim.db', 'oleo.puesto', 'oleo.solicitud', 'oleo.outbox', 'oleo.nivel']) localStorage.removeItem(k);
      api.cache.pendientes = null;
      api.cache.puestos.clear();
      api.cache.recolecciones.clear();
      aviso('Datos locales borrados.');
      pintar();
    });
    $('#btn-enviar-cola', raiz)?.addEventListener('click', async () => { await api.procesarCola(); pintar(); });
    $('#btn-cerrar-sesion', raiz)?.addEventListener('click', async () => {
      if (!(await confirmar('¿Cerrar la sesión del puesto en este teléfono? Necesitarás el Puesto ID y el PIN para volver a entrar.', { aceptar: 'Sí, cerrar' }))) return;
      api.cerrarSesion();
      pintar();
    });
    if (local) pintarSim();
    pintarSW();
  }

  async function pintarSim() {
    const el = $('#estado-sim', raiz);
    if (!el) return;
    const sim = await api.obtenerSimulador();
    const e = sim.estado();
    el.textContent = `${e.registros.Puestos} puestos, ${e.registros.Solicitudes} solicitudes y ${e.registros.Recolecciones} recolecciones. Créditos de Make que habría consumido: ${fmtNum(e.creditos)}.`;
  }

  async function pintarSW() {
    const el = $('#estado-sw', raiz);
    if (!('serviceWorker' in navigator)) { el.textContent = 'Sin service worker'; return; }
    const reg = await navigator.serviceWorker.getRegistration();
    el.textContent = reg?.active ? 'App disponible sin conexión' : 'Preparando modo sin conexión';
  }

  // Envía una muestra a una URL de Make y muestra lo que se pueda leer de la respuesta.
  async function probarUrl(url, campos, nombre) {
    if (!url) { salida(`Falta la URL del ${nombre}.`); return; }
    const cuerpo = new URLSearchParams(campos);
    salida(`Enviando muestra al ${nombre}`);
    const t0 = performance.now();
    try {
      const r = await fetch(url, { method: 'POST', body: cuerpo });
      const texto = await r.text();
      salida(`Status ${r.status} en ${fmtNum(performance.now() - t0)} ms, ${fmtKB(bytesUtf8(cuerpo.toString()) + bytesUtf8(texto))}.\n${texto}`);
    } catch (e) {
      salida(`Se envió la petición, pero el navegador no pudo leer la respuesta (${e.message}). Si Make está en "Redetermine data structure", revisa que diga "Successfully determined". Si el escenario está activo, agrega el header Access-Control-Allow-Origin: * a su Webhook response.`);
    }
  }

  pintar();
}
