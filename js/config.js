// Configuración de OLEO: valores por defecto y persistencia en localStorage.
// Para la demo en la nube, pega aquí la URL del webhook del Escenario A de Make (sección 14.3).

export const VERSION = '1.0.0'; // debe coincidir con VERSION en sw.js

export const DEFAULTS = Object.freeze({
  webhook: '',             // URL del Escenario A "OLEO API". Vacía = modo local
  apiFinanciera: '',       // URL del Escenario B, solo para el botón de prueba
  modo: 'nube',            // 'nube' o 'local'
  precioLitro: 3.0,        // MXN por litro al comerciante
  taraKg: 1.2,             // peso del bote vacío de 20 L
  densidad: 0.91,          // kg/L de AVU
  umbralNTU: 100,          // turbidez máxima aceptada (igual que la fórmula Calidad de Airtable)
  recolector: 'Unidad 01',
  ventana: '20:00 a 24:00',
  pollComercianteMs: 8000,
  pollComercianteMax: 12,
  pollRecolectorMs: 5000,
  pollRecolectorMax: 36,
  impactoAutoMs: 0         // refresco automático del tablero (0 = apagado)
});

export const TIPOS_NEGOCIO = ['Puesto de tacos', 'Fonda', 'Pollo frito', 'Antojitos', 'Restaurante', 'Otro'];
export const CONTENEDOR = 'Bote hermético 20 L en comodato';

const CLAVE = 'oleo.config.v1';
const NUMERICOS = new Set(Object.keys(DEFAULTS).filter((k) => typeof DEFAULTS[k] === 'number'));

let actual = null;
const oyentes = new Set();

function leerGuardado() {
  try { return JSON.parse(localStorage.getItem(CLAVE) || '{}') || {}; } catch { return {}; }
}

export function obtenerConfig() {
  if (!actual) actual = { ...DEFAULTS, ...leerGuardado() };
  return actual;
}

// Guarda solo lo que difiere de DEFAULTS, así una URL pegada en este archivo no queda tapada
// por un valor viejo guardado en el teléfono.
export function guardarConfig(cambios) {
  const nueva = { ...obtenerConfig(), ...normalizar(cambios) };
  const diferencias = {};
  for (const k of Object.keys(DEFAULTS)) if (nueva[k] !== DEFAULTS[k]) diferencias[k] = nueva[k];
  try { localStorage.setItem(CLAVE, JSON.stringify(diferencias)); } catch { /* sin almacenamiento */ }
  actual = nueva;
  oyentes.forEach((fn) => fn(actual));
  return actual;
}

export function restablecerConfig() {
  try { localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
  actual = { ...DEFAULTS };
  oyentes.forEach((fn) => fn(actual));
  return actual;
}

export function alCambiarConfig(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }

function normalizar(cambios) {
  const r = {};
  for (const [k, v] of Object.entries(cambios || {})) {
    if (!(k in DEFAULTS)) continue;
    if (NUMERICOS.has(k)) {
      const n = Number(v);
      r[k] = Number.isFinite(n) ? n : DEFAULTS[k];
    } else {
      r[k] = String(v ?? '').trim();
    }
  }
  if (r.modo && r.modo !== 'local') r.modo = 'nube';
  return r;
}

// 'local' si así se eligió o si no hay URL de webhook; 'nube' en otro caso.
export function modoEfectivo(c = obtenerConfig()) {
  return c.modo === 'local' || !c.webhook ? 'local' : 'nube';
}
