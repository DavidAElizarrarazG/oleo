// Asistente del comerciante (#/asistente): chat con Claude vía Make, o con el modelo simulado en modo local.

import * as api from '../api.js';
import { modoEfectivo } from '../config.js';
import { cargarConversacion, nuevaConversacion, enviarMensaje, guardar, turnosUsuario, MAX_TURNOS } from '../agente.js';
import { $, esc, fmtL, fmtKg, fmtMoneda, fmtClave, fmtKB, fmtSeg, aviso, confirmar } from '../util.js';
import { medidorDatos } from './componentes.js';

const SUGERENCIAS = ['¿Cuánto llevo ganado?', 'Mi bote ya está lleno', 'Quiero cobrar', '¿A qué hora pasan?'];

// Texto del modelo -> HTML seguro: saltos de línea y **negritas**. Sin guiones largos en la interfaz.
function formato(texto) {
  return esc(String(texto).replace(/\s*\u2014\s*/g, ', '))
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

export default async function asistente({ raiz, senal, ir }) {
  const sesion = api.sesionPuesto();
  if (!sesion) return ir('#/comerciante/alta', { reemplazar: true });
  const local = modoEfectivo() === 'local';
  let c = cargarConversacion(sesion);
  let ocupado = false;
  let estado = null;
  let cobroPendiente = null; // { tarjeta, resolver }

  raiz.innerHTML = `
    <div class="fila-entre">
      <div class="encabezado">
        <h1>Asistente</h1>
        <p class="secundario">${esc(sesion.nombre)}, ${esc(sesion.puestoId)}</p>
      </div>
      <button class="btn-chico" id="btn-nueva">Nueva conversación</button>
    </div>
    <p class="nota">${local
      ? 'Modo local: respuestas simuladas, sin IA.'
      : 'Asistente con IA (Claude). Puede equivocarse; los cobros siempre los confirmas tú.'}</p>
    <div class="chat" id="chat"></div>
    <div class="sugerencias" id="sugerencias"></div>
    <form class="redactor" id="redactor">
      <label for="entrada" class="solo-lector">Escribe tu mensaje</label>
      <textarea id="entrada" rows="1" maxlength="500" placeholder="Escribe tu pregunta" autocomplete="off"></textarea>
      <button class="btn btn-primario" type="submit" id="btn-enviar">Enviar</button>
    </form>
    ${medidorDatos(null)}`;

  const chat = $('#chat', raiz);
  const entrada = $('#entrada', raiz);

  function tarjetaCobro(t) {
    const activa = cobroPendiente?.tarjeta === t;
    let pie = '';
    if (t.estado === 'pendiente' && activa) {
      pie = `<button class="btn btn-primario" data-cobro="confirmar">Confirmar y cobrar</button>
             <button class="btn btn-secundario" data-cobro="no_coincide">No coincide</button>`;
    } else if (t.estado === 'pendiente') {
      pie = '<p class="chico secundario">Sin respuesta. Puedes cobrar desde Mi puesto.</p>';
    } else if (t.estado === 'pagado') {
      pie = `<p class="fuerte">Recibiste ${fmtMoneda(t.monto)}</p>
             <p class="chico">Clave de rastreo <span class="mono">${esc(fmtClave(t.clave))}</span>${t.latenciaMs ? `. Abono en ${fmtSeg(t.latenciaMs / 1000)}` : ''}.</p>
             <a class="btn btn-exito" href="#/constancia/${esc(t.recId)}">Ver constancia</a>`;
    } else if (t.estado === 'no_coincide') {
      pie = '<p class="fuerte">Avisamos al recolector para volver a pesar.</p>';
    } else if (t.estado === 'cancelado') {
      pie = '<p class="chico secundario">No se cobró.</p>';
    } else if (t.estado === 'error') {
      pie = `<p class="mensaje-error">${esc(t.error || 'No se pudo cobrar.')}</p>`;
    }
    return `<section class="panel ${t.estado === 'pagado' ? 'panel-exito' : 'panel-destacado'} pila tarjeta-cobro" aria-label="Recolección ${esc(t.folio)}">
      <p>El recolector registró <strong>${fmtL(t.litros)}</strong> (${fmtKg(t.netoKg)} netos). Pago: <strong>${fmtMoneda(t.monto)}</strong>. ¿Coincide con lo que entregaste?</p>
      <p class="chico secundario">${esc(t.folio)}. Transferencia SPEI simulada.</p>
      ${pie}
    </section>`;
  }

  function pintar() {
    chat.innerHTML = c.vista.map((v) => {
      if (v.tipo === 'usuario') return `<div class="burbuja burbuja-usuario">${esc(v.texto)}</div>`;
      if (v.tipo === 'asistente') return `<div class="burbuja burbuja-asistente">${formato(v.texto)}</div>`;
      if (v.tipo === 'cobro') return tarjetaCobro(v);
      return `<p class="chat-nota${v.error ? ' mensaje-error' : ''}">${esc(v.texto)}</p>`;
    }).join('') + (estado ? `<p class="chat-estado" role="status">${esc(estado)}</p>` : '');
    if (!c.vista.length) {
      chat.innerHTML = `<div class="burbuja burbuja-asistente">Hola. Puedo decirte cuánto llevas ganado, avisar que tu bote está lleno o ayudarte a cobrar una recolección.</div>`;
    }
    $('#sugerencias', raiz).innerHTML = c.vista.length || ocupado ? ''
      : SUGERENCIAS.map((s) => `<button class="btn-chico" type="button" data-sugerencia="${esc(s)}">${esc(s)}</button>`).join('');
    $('#btn-enviar', raiz).disabled = ocupado;
    entrada.disabled = ocupado;
    window.scrollTo(0, document.body.scrollHeight);
  }

  const ui = {
    actualizar: () => { if (!senal.aborted) pintar(); },
    estado: (t) => { estado = t; if (!senal.aborted) pintar(); },
    pedirCobro: (tarjeta) => new Promise((resolver) => {
      cobroPendiente = { tarjeta, resolver };
      if (!senal.aborted) pintar();
    })
  };

  // Si el comerciante sale con la tarjeta abierta, se toma como "no cobrar".
  senal.addEventListener('abort', () => { cobroPendiente?.resolver('cancelar'); cobroPendiente = null; });

  chat.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cobro]');
    if (!b || !cobroPendiente) return;
    const { resolver } = cobroPendiente;
    cobroPendiente = null;
    estado = b.dataset.cobro === 'confirmar' ? 'Cobrando' : 'Avisando al recolector';
    pintar();
    resolver(b.dataset.cobro);
  });

  async function mandar(texto) {
    texto = texto.trim();
    if (ocupado || !texto) return;
    if (turnosUsuario(c) >= MAX_TURNOS) {
      aviso('La conversación ya es larga. Empieza una nueva para seguir.');
      return;
    }
    ocupado = true;
    entrada.value = '';
    try {
      const bytes = await enviarMensaje(c, texto, sesion, ui);
      if (!senal.aborted) $('#medidor', raiz).textContent = `Este mensaje usó ${fmtKB(bytes)} de datos`;
    } catch (e) {
      c.vista.push({ tipo: 'nota', texto: e.message || 'No se pudo enviar. Intenta de nuevo.', error: true });
      guardar(c);
    } finally {
      ocupado = false;
      if (!senal.aborted) { pintar(); entrada.focus(); }
    }
  }

  $('#redactor', raiz).addEventListener('submit', (e) => { e.preventDefault(); mandar(entrada.value); });
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar(entrada.value); }
  });
  $('#sugerencias', raiz).addEventListener('click', (e) => {
    const b = e.target.closest('[data-sugerencia]');
    if (b) mandar(b.dataset.sugerencia);
  });
  $('#btn-nueva', raiz).addEventListener('click', async () => {
    if (ocupado) return;
    if (c.vista.length && !(await confirmar('¿Empezar una conversación nueva? La actual se borra de este teléfono.', { aceptar: 'Sí, empezar' }))) return;
    c = nuevaConversacion(sesion);
    pintar();
  });

  pintar();
}
