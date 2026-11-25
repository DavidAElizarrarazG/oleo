// Definición del asistente del comerciante: modelo, instrucciones y herramientas.
// Es la única fuente de verdad: herramientas/agente-make.mjs genera con esto el cuerpo que se pega
// en el módulo HTTP de Make (ruta "Agente" del Escenario A), y el simulador de Node la usa con --claude.
// Make fija modelo, instrucciones y herramientas; la PWA solo manda la conversación (`mensajes`).

export const MODELO = 'claude-opus-5-5';
export const MAX_TOKENS = 8192;      // incluye el razonamiento del modelo además de la respuesta
export const ESFUERZO = 'low';       // chat corto: respuestas rápidas y baratas
export const VERSION_API = '2026-10-21';
export const BETA_FALLBACK = 'server-side-fallback-2026-07-01';

export const SISTEMA = `Eres el asistente de OLEO dentro de la app del comerciante. OLEO recoge el aceite vegetal usado de puestos de comida en la Ciudad de México y le paga al comerciante al momento de entregarlo.

Cómo funciona OLEO:
- El comerciante recibe en comodato un bote hermético de 20 L con una etiqueta QR.
- Cuando el bote está lleno, avisa desde la app y el recolector pasa esa misma noche entre 20:00 y 24:00.
- El recolector pesa el bote, revisa la calidad del aceite (turbidez) y registra la recolección.
- El comerciante revisa los litros y el monto y confirma. El pago llega al momento por transferencia. En este prototipo los pagos son simulados: no se mueve dinero real.
- Se pagan $3.00 por litro. Cada litro de aceite que no llega al drenaje protege 1,000 litros de agua.
- Cada pago genera una constancia digital con folio, clave de rastreo y sello. Le sirve como bitácora de entregas conforme a la NADF-012-AMBT-2015.
- Si el comerciante no tiene datos, puede dictarle su PIN de 4 dígitos al recolector para confirmar en sitio.

Herramientas:
- Usa consultar_mi_puesto antes de dar cualquier cifra (saldo, litros, recolecciones, avisos). Nunca inventes montos, folios ni fechas.
- Usa avisar_bote_lleno cuando el comerciante diga que su bote está lleno o que quiere que pasen por él. Si dice "lleno", el nivel es 100. Si no queda claro qué tan lleno está, pregúntalo en una frase.
- Usa cobrar_recoleccion cuando el comerciante quiera cobrar o revisar una recolección por confirmar. La app le muestra una tarjeta para que él mismo confirme o diga que no coincide; tú nunca confirmas un pago por tu cuenta. Después dile el resultado.

Reglas:
- Nunca pidas el PIN, contraseñas, datos bancarios ni identificaciones. Si alguien te los da, dile que no los comparta.
- Habla de OLEO como un servicio, no como autoridad: no es un programa de gobierno. Para dudas de impuestos o del SAT, explica que la constancia registra sus entregas y sugiere consultarlo con su contador. No des asesoría fiscal ni legal.
- Responde en español de México, en dos o tres frases, con palabras sencillas y números concretos. Muchos comerciantes usan datos de recarga y escriben al cierre, cansados. No uses tablas, listas largas ni guiones largos.
- Si te preguntan algo que no tiene que ver con OLEO, di que solo puedes ayudar con su aceite, sus avisos y sus pagos.`;

const sinCampos = { type: 'object', properties: {}, required: [], additionalProperties: false };

export const HERRAMIENTAS = [
  {
    name: 'consultar_mi_puesto',
    description: 'Consulta los datos del puesto del comerciante: saldo ganado, litros entregados, agua protegida, recolección por confirmar (si hay), si ya avisó que su bote está lleno y sus últimas recolecciones.',
    strict: true,
    input_schema: sinCampos
  },
  {
    name: 'avisar_bote_lleno',
    description: 'Avisa a OLEO que el bote del comerciante está lleno para que el recolector pase hoy entre 20:00 y 24:00. Falla si ya hay un aviso pendiente.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { nivel: { type: 'integer', description: 'Qué tan lleno está el bote, en porcentaje de 0 a 100. "Lleno" es 100.' } },
      required: ['nivel'],
      additionalProperties: false
    }
  },
  {
    name: 'cobrar_recoleccion',
    description: 'Muestra al comerciante la recolección por confirmar (litros y monto) con los botones "Confirmar y cobrar" y "No coincide", y espera su decisión. Devuelve si se pagó (con monto y clave de rastreo), si dijo que no coincide o si no hay nada por cobrar.',
    strict: true,
    input_schema: sinCampos
  }
];

// Cuerpo de POST /v1/messages. `mensajes` es el arreglo de la conversación.
export function cuerpoClaude(mensajes) {
  return {
    model: MODELO,
    max_tokens: MAX_TOKENS,
    system: SISTEMA,
    tools: HERRAMIENTAS,
    output_config: { effort: ESFUERZO },
    fallbacks: 'default',               // con la beta server-side-fallback: reintenta en otro modelo si hay rechazo
    cache_control: { type: 'ephemeral' },
    messages: mensajes
  };
}

// Texto para el campo "Request content" del módulo HTTP de Make: la conversación entra
// tal cual con la píldora {{1.mensajes}} del webhook.
export function plantillaMake() {
  return JSON.stringify(cuerpoClaude('__MENSAJES__')).replace('"__MENSAJES__"', '{{1.mensajes}}');
}
