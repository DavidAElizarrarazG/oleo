// Modelo simulado del asistente (modo local y pruebas). No es IA: reconoce frases comunes,
// pide las mismas herramientas que el modelo real y responde con la forma de la API de Messages.
// La app lo rotula como "respuestas simuladas".

const VENTANA = '20:00 a 24:00';
const moneda = (n) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n, d = 0) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
const normalizar = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const id = (p) => `${p}${Math.random().toString(36).slice(2, 12)}`;

function mensaje(content, stop) {
  return {
    id: id('msg_sim_'), type: 'message', role: 'assistant', model: 'simulado-local',
    content, stop_reason: stop, stop_details: null, usage: { input_tokens: 0, output_tokens: 0 }
  };
}
const texto = (t) => mensaje([{ type: 'text', text: t }], 'end_turn');
const usar = (nombre, input, previo) => mensaje([
  ...(previo ? [{ type: 'text', text: previo }] : []),
  { type: 'tool_use', id: id('toolu_sim_'), name: nombre, input }
], 'tool_use');

function nombreHerramienta(mensajes, toolUseId) {
  for (const m of mensajes) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const b = m.content.find((x) => x.type === 'tool_use' && x.id === toolUseId);
    if (b) return b.name;
  }
  return null;
}

function despuesDeHerramienta(nombre, r) {
  if (r.error) return `No pude completarlo: ${r.error}`;
  if (nombre === 'consultar_mi_puesto') {
    const s = r.saldo || {};
    let t = `Llevas ${moneda(s.pesosGanados)} ganados por ${num(s.litrosEntregados, 1)} L de aceite, que protegieron ${num(s.aguaProtegidaLitros)} L de agua.`;
    if (r.recoleccionPorConfirmar) {
      const p = r.recoleccionPorConfirmar;
      t += ` Tienes una recolección por confirmar: ${num(p.litros, 2)} L por ${moneda(p.monto)}. Si quieres cobrarla, dime "quiero cobrar".`;
    } else if (r.avisoPendiente) {
      t += ` Ya avisaste que tu bote está lleno; pasamos hoy entre ${VENTANA}.`;
    }
    return t;
  }
  if (nombre === 'avisar_bote_lleno') {
    if (r.ok === false) return r.motivo || 'No pude avisar. Intenta desde Mi puesto.';
    return `Listo, avisé que tu bote está al ${r.nivel}%. Pasamos por él hoy entre ${VENTANA}.`;
  }
  if (nombre === 'cobrar_recoleccion') {
    if (r.resultado === 'pagado') return `Recibiste ${moneda(r.monto)} por ${num(r.litros, 2)} L. Tu clave de rastreo es ${r.claveRastreo}. Tu constancia está en Mi puesto.`;
    if (r.resultado === 'no_coincide') return 'Avisé al recolector que no coincide para que vuelva a pesar.';
    if (r.resultado === 'sin_recoleccion') return 'No tienes ninguna recolección por confirmar en este momento.';
    return 'Va, no cobré nada. Cuando quieras, dime "quiero cobrar".';
  }
  return 'Listo.';
}

// mensajes: arreglo de la conversación (formato de la API). Devuelve un objeto mensaje.
export function respuestaSimulada(mensajes) {
  const ultimo = mensajes[mensajes.length - 1] || {};
  const bloques = Array.isArray(ultimo.content) ? ultimo.content : [{ type: 'text', text: String(ultimo.content || '') }];

  const resultados = bloques.filter((b) => b.type === 'tool_result');
  const textoUsuario = bloques.filter((b) => b.type === 'text' && !b.text.startsWith('<contexto>')).map((b) => b.text).join(' ');
  if (resultados.length && !textoUsuario.trim()) {
    const partes = resultados.map((b) => {
      let r = {};
      try { r = JSON.parse(typeof b.content === 'string' ? b.content : b.content?.[0]?.text || '{}'); } catch { /* resultado no JSON */ }
      return despuesDeHerramienta(nombreHerramienta(mensajes, b.tool_use_id), r);
    });
    return texto(partes.join(' '));
  }

  const t = normalizar(textoUsuario);
  if (/\b(pin|contrasena|tarjeta|clabe|cuenta bancaria)\b/.test(t)) {
    return texto('No compartas tu PIN ni datos bancarios por aquí. El PIN solo se lo dictas al recolector en tu puesto.');
  }
  if (/\b(sat|impuesto|hacienda|factura)/.test(t)) {
    return texto('OLEO es un servicio de recolección, no un programa de gobierno. Tu constancia registra cada entrega; para dudas de impuestos, consúltalo con tu contador.');
  }
  if (/(lleno|llena|pasen|recojan|recoger)/.test(t)) {
    const m = t.match(/(\d{1,3})\s*(%|por ?ciento)/);
    return usar('avisar_bote_lleno', { nivel: m ? Math.min(100, Number(m[1])) : 100 }, 'Ahorita aviso.');
  }
  if (/(cobr|pagame|confirm|coincide)/.test(t)) {
    return usar('cobrar_recoleccion', {}, 'Te muestro la recolección para que la confirmes.');
  }
  if (/(saldo|gan|cuanto|litros|constancia|recoleccion|aviso|agua)/.test(t)) {
    return usar('consultar_mi_puesto', {});
  }
  if (/(hora|cuando|horario|que dia)/.test(t)) {
    return texto(`Pasamos de ${VENTANA}, la misma noche en que avisas que tu bote está lleno.`);
  }
  return texto('Puedo decirte cuánto llevas ganado, avisar que tu bote está lleno o ayudarte a cobrar una recolección. ¿Qué necesitas?');
}

// Manejador para el simulador de Make: devuelve { status, body } como lo haría la API.
export async function manejadorSimulado(mensajes) {
  if (!Array.isArray(mensajes) || !mensajes.length) {
    return { status: 400, body: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'messages: se requiere al menos un mensaje' } }) };
  }
  return { status: 200, body: JSON.stringify(respuestaSimulada(mensajes)) };
}
