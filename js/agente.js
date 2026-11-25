// Asistente del comerciante: ciclo de herramientas en el navegador.
// La conversación (formato de la API de Messages) se guarda en el teléfono y se reenvía sin
// modificar en cada turno: el historial solo crece, nunca se edita (requisito para conservar
// el razonamiento del modelo entre turnos). Las herramientas usan el mismo adaptador que la app.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { impactoTotal } from './metrics.js';

const CLAVE = 'oleo.agente';
const MAX_PASOS = 6;          // llamadas al modelo por mensaje del comerciante (acota el costo)
export const MAX_TURNOS = 20; // después, se sugiere empezar una conversación nueva

// ---------- Conversación ----------
export function cargarConversacion(sesion) {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE));
    if (c && c.puestoId === sesion.puestoId && Array.isArray(c.mensajes)) return c;
  } catch { /* conversación dañada: se empieza otra */ }
  return nuevaConversacion(sesion);
}

export function nuevaConversacion(sesion) {
  const c = { puestoId: sesion.puestoId, creada: new Date().toISOString(), mensajes: [], vista: [] };
  guardar(c);
  return c;
}

export function guardar(c) {
  try { localStorage.setItem(CLAVE, JSON.stringify(c)); } catch (e) { console.error('No se pudo guardar la conversación', e); }
}

export const turnosUsuario = (c) => c.vista.filter((v) => v.tipo === 'usuario').length;

function contexto(sesion) {
  const ahora = new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date());
  return `<contexto>Puesto: ${sesion.nombre} (${sesion.puestoId}), alcaldía ${sesion.alcaldia || 'sin dato'}, cierra a las ${sesion.cierre || 'sin dato'}. Fecha y hora: ${ahora}.</contexto>`;
}

// Tras un cambio al modelo de respaldo (bloque "fallback"), los bloques de razonamiento y las
// llamadas a herramientas anteriores al último cambio no se reenvían; el resto va tal cual.
export function paraReenviar(content) {
  const corte = content.map((b) => b.type).lastIndexOf('fallback');
  if (corte < 0) return content;
  return content.filter((b, i) => i >= corte || b.type === 'text' || b.type === 'fallback');
}

// ---------- Envío de un mensaje del comerciante ----------
// ui: { actualizar(), estado(texto|null), pedirCobro(entradaVista) -> Promise<'confirmar'|'no_coincide'|'cancelar'> }
// Devuelve los bytes usados (petición + respuesta) en todo el intercambio.
export async function enviarMensaje(c, texto, sesion, ui) {
  const contenido = [];
  // Llamadas que quedaron sin respuesta (por ejemplo, se cerró la app con la tarjeta de cobro abierta).
  const ultimo = c.mensajes[c.mensajes.length - 1];
  if (ultimo?.role === 'assistant') {
    for (const b of ultimo.content.filter((x) => x.type === 'tool_use')) {
      contenido.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ resultado: 'sin_respuesta' }), is_error: true });
    }
  }
  if (!c.mensajes.length) contenido.push({ type: 'text', text: contexto(sesion) });
  contenido.push({ type: 'text', text: texto });
  c.mensajes.push({ role: 'user', content: contenido });
  c.vista.push({ tipo: 'usuario', texto });
  guardar(c);
  ui.actualizar();

  let bytes = 0;
  try {
    for (let paso = 0; paso < MAX_PASOS; paso++) {
      ui.estado(paso === 0 ? 'Escribiendo' : 'Revisando');
      const { respuesta, bytes: b } = await api.agente(c.mensajes);
      bytes += b;
      c.modelo = respuesta.model;

      if (respuesta.stop_reason === 'refusal') {
        // No se agrega al historial: el rechazo se descarta.
        c.vista.push({ tipo: 'asistente', texto: 'No puedo ayudarte con eso. Pregúntame por tu aceite, tus avisos o tus pagos.' });
        break;
      }
      const bloques = paraReenviar(respuesta.content || []);
      if (bloques.length) c.mensajes.push({ role: 'assistant', content: bloques });
      const textos = bloques.filter((x) => x.type === 'text').map((x) => x.text).join('\n\n').trim();
      if (textos) c.vista.push({ tipo: 'asistente', texto: textos });
      guardar(c);
      ui.actualizar();

      if (respuesta.stop_reason === 'max_tokens') {
        c.vista.push({ tipo: 'nota', texto: 'La respuesta quedó incompleta. Intenta con una pregunta más corta.' });
        break;
      }
      const usos = bloques.filter((x) => x.type === 'tool_use');
      if (respuesta.stop_reason !== 'tool_use' || !usos.length) break;

      const resultados = [];
      for (const uso of usos) resultados.push(await ejecutar(uso, c, sesion, ui));
      c.mensajes.push({ role: 'user', content: resultados });
      guardar(c);
    }
  } finally {
    ui.estado(null);
    guardar(c);
    ui.actualizar();
  }
  return bytes;
}

// ---------- Herramientas ----------
async function ejecutar(uso, c, sesion, ui) {
  const resultado = (datos, error = false) => ({
    type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(datos), ...(error ? { is_error: true } : {})
  });
  try {
    if (uso.name === 'consultar_mi_puesto') {
      ui.estado('Consultando tu puesto');
      return resultado(await consultarPuesto(sesion));
    }
    if (uso.name === 'avisar_bote_lleno') {
      const nivel = Number(uso.input?.nivel);
      if (!Number.isInteger(nivel) || nivel < 0 || nivel > 100) return resultado({ error: 'nivel debe ser un entero de 0 a 100' }, true);
      ui.estado('Avisando que tu bote está lleno');
      return resultado(await avisar(sesion, nivel, c));
    }
    if (uso.name === 'cobrar_recoleccion') {
      ui.estado('Buscando tu recolección');
      return resultado(await cobrar(sesion, c, ui));
    }
    return resultado({ error: `Herramienta desconocida: ${uso.name}` }, true);
  } catch (e) {
    console.error('Herramienta del asistente', uso.name, e);
    return resultado({ error: e.message || 'No se pudo completar' }, true);
  }
}

// ¿El aviso guardado en el teléfono ya se atendió? (hay una recolección registrada después)
function avisoVigente(recs) {
  const sol = api.solicitudLocal();
  if (sol && !sol.pendiente && recs.some((r) => r.fechaValidacion && new Date(r.fechaValidacion) > new Date(sol.creada))) {
    api.guardarSolicitudLocal(null);
    return null;
  }
  return sol;
}

async function consultarPuesto(sesion) {
  const cfg = obtenerConfig();
  const recs = await api.recoleccionesDe(sesion.puestoId);
  const t = impactoTotal(recs);
  const pc = recs.find((r) => r.estado === 'Por confirmar');
  return {
    puesto: { puestoId: sesion.puestoId, nombre: sesion.nombre, alcaldia: sesion.alcaldia, cierre: sesion.cierre },
    precioPorLitro: cfg.precioLitro,
    ventanaRecoleccion: cfg.ventana,
    saldo: { pesosGanados: t.pesos, litrosEntregados: t.litros, aguaProtegidaLitros: t.agua, recoleccionesPagadas: t.recolecciones },
    recoleccionPorConfirmar: pc ? { folio: pc.folio, litros: pc.litros, kgNetos: pc.netoKg, monto: pc.monto } : null,
    avisoPendiente: !!avisoVigente(recs),
    ultimasRecolecciones: recs.slice(0, 5).map((r) => ({ folio: r.folio, estado: r.estado, litros: r.litros, monto: r.monto, fechaAbono: r.fechaAbono || null }))
  };
}

async function avisar(sesion, nivel, c) {
  const cfg = obtenerConfig();
  if (api.solicitudLocal()) {
    return { ok: false, motivo: `Ya hay un aviso pendiente; pasamos hoy entre ${cfg.ventana}.` };
  }
  const s = await api.solicitar(sesion.id, nivel);
  api.guardarSolicitudLocal(s);
  try { localStorage.setItem('oleo.nivel', String(nivel)); } catch { /* sin almacenamiento */ }
  c.vista.push({ tipo: 'accion', texto: s.pendiente ? `Aviso guardado sin señal (${nivel}%); se enviará solo.` : `Aviso enviado: bote al ${nivel}%.` });
  return { ok: true, nivel, ventana: cfg.ventana, folio: s.folio || null, enviadoSinSenal: !!s.pendiente };
}

async function cobrar(sesion, c, ui) {
  const recs = await api.recoleccionesDe(sesion.puestoId);
  const pc = recs.find((r) => r.estado === 'Por confirmar');
  if (!pc) return { resultado: 'sin_recoleccion' };

  const tarjeta = { tipo: 'cobro', recId: pc.id, folio: pc.folio, litros: pc.litros, netoKg: pc.netoKg, monto: pc.monto, estado: 'pendiente' };
  c.vista.push(tarjeta);
  guardar(c);
  ui.actualizar();
  ui.estado(null);
  const decision = await ui.pedirCobro(tarjeta);

  if (decision === 'confirmar') {
    try {
      const pago = await api.pagar(pc.id, sesion.pin, 'app');
      Object.assign(tarjeta, { estado: 'pagado', clave: pago.claveRastreo, latenciaMs: pago.latenciaMs, monto: pago.monto });
      return { resultado: 'pagado', folio: pago.folio, litros: pago.litros, monto: pago.monto, aguaProtegidaLitros: pago.agua, claveRastreo: pago.claveRastreo, segundosHastaAbono: Math.round(pago.latenciaMs / 100) / 10, rail: 'SPEI simulado' };
    } catch (e) {
      Object.assign(tarjeta, { estado: 'error', error: e.message });
      return { resultado: 'error', error: e.message };
    }
  }
  if (decision === 'no_coincide') {
    await api.rechazar(pc.id);
    tarjeta.estado = 'no_coincide';
    return { resultado: 'no_coincide', folio: pc.folio };
  }
  tarjeta.estado = 'cancelado';
  return { resultado: 'cancelado' };
}
