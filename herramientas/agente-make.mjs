// Genera el texto del campo "Request content" del módulo HTTP de la ruta Agente (Escenario A de Make).
// Uso: node herramientas/agente-make.mjs        (lo imprime y lo guarda en docs/make-agente-cuerpo.json)
// Cópialo completo y pégalo tal cual en Make: {{1.mensajes}} se convierte en la píldora del webhook.
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plantillaMake, MODELO, ESFUERZO, VERSION_API, BETA_FALLBACK } from '../js/agente-definicion.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const texto = plantillaMake();

// Comprobación: con una conversación de ejemplo en lugar de la píldora, debe ser JSON válido.
JSON.parse(texto.replace('{{1.mensajes}}', '[{"role":"user","content":"Hola"}]'));

await writeFile(join(raiz, 'docs/make-agente-cuerpo.json'), texto + '\n');
console.log(`Modelo ${MODELO}, esfuerzo ${ESFUERZO}. Headers del módulo HTTP:`);
console.log(`  x-api-key: <tu API key de Anthropic>`);
console.log(`  anthropic-version: ${VERSION_API}`);
console.log(`  anthropic-beta: ${BETA_FALLBACK}`);
console.log(`  content-type: application/json`);
console.log('\nRequest content (también en docs/make-agente-cuerpo.json):\n');
console.log(texto);
