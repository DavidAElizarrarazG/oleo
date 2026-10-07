// Datos de ejemplo (sección 14.1, paso 5): 6 puestos inventados, 2 solicitudes pendientes y
// 10 recolecciones pagadas repartidas en los últimos 7 días. Los nombres son ficticios; no son
// los de las personas entrevistadas. Lo usan el simulador local y herramientas/sembrar-airtable.mjs.

import { derivar } from '../metrics.js';

const PUESTOS = [
  ['Tacos Los Primos', 'Puesto de tacos', 'Cuauhtémoc', 'Doctores', '22:30', 19.4205, -99.1462, 'Ramón'],
  ['Fonda La Esperanza', 'Fonda', 'Benito Juárez', 'Narvarte', '18:30', 19.3911, -99.1555, 'Carmen'],
  ['Pollos El Rey', 'Pollo frito', 'Iztapalapa', 'Santa Cruz Meyehualco', '21:00', 19.3631, -99.0596, ''],
  ['Garnachas La Esquina', 'Antojitos', 'Coyoacán', 'Santo Domingo', '23:00', 19.3299, -99.1645, 'Lety'],
  ['Quesadillas Doña Lupe', 'Antojitos', 'Venustiano Carranza', 'Moctezuma', '20:00', 19.4341, -99.1063, 'Guadalupe'],
  ['Cocina Económica El Sabor', 'Fonda', 'Miguel Hidalgo', 'Tacuba', '19:00', 19.4583, -99.1874, '']
];

// [índice del puesto, kg brutos, NTU, días atrás, hora, minuto, segundos al abono, canal]
const RECOLECCIONES = [
  [0, 16.42, 31.5, 6, 21, 12, 38, 'App del comerciante'],
  [1, 12.08, 44.0, 6, 20, 25, 52, 'App del comerciante'],
  [2, 18.37, 27.8, 5, 22, 5, 31, 'PIN en sitio'],
  [3, 10.91, 58.2, 4, 23, 18, 46, 'App del comerciante'],
  [4, 14.55, 36.9, 4, 20, 40, 27, 'App del comerciante'],
  [0, 17.10, 29.4, 3, 21, 30, 41, 'App del comerciante'],
  [5, 9.86, 49.7, 2, 20, 10, 64, 'PIN en sitio'],
  [2, 15.73, 33.1, 1, 22, 15, 35, 'App del comerciante'],
  [1, 13.29, 40.6, 1, 20, 50, 29, 'App del comerciante'],
  [3, 11.64, 52.3, 0, 20, 22, 44, 'App del comerciante']
];

const SOLICITUDES = [[0, 85], [4, 90]];

const pad = (n, l = 2) => String(n).padStart(l, '0');
const marca = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export function generarDatosEjemplo(ahora = new Date(), config = { taraKg: 1.2, densidad: 0.91, precioLitro: 3, umbralNTU: 100 }) {
  const puestos = PUESTOS.map(([nombre, tipo, alcaldia, colonia, cierre, lat, lng, responsable], i) => ({
    'Nombre del puesto': nombre,
    'Responsable': responsable || undefined,
    'Tipo de negocio': tipo,
    'Alcaldía': alcaldia,
    'Colonia': colonia,
    'Cierre': cierre,
    'Latitud': lat,
    'Longitud': lng,
    'PIN': String(1000 + ((i + 1) * 2741) % 9000),
    'Contenedor': 'Bote hermético 20 L en comodato'
  }));

  const recolecciones = RECOLECCIONES.map(([p, bruto, ntu, dias, hora, minuto, seg, canal], i) => {
    const validacion = new Date(ahora);
    validacion.setDate(validacion.getDate() - dias);
    validacion.setHours(hora, minuto, 7 + i, 0);
    // Si la hora cae en el futuro (recolección "de hoy"), la movemos una hora antes de ahora.
    if (validacion > ahora) validacion.setTime(ahora.getTime() - 3600e3 - i * 60e3);
    const abono = new Date(validacion.getTime() + seg * 1000);
    const d = derivar({ brutoKg: bruto, taraKg: config.taraKg, densidad: config.densidad, precioLitro: config.precioLitro, ntu, umbral: config.umbralNTU });
    return {
      puesto: p,
      derivados: d,
      fields: {
        'Recolector': i % 3 === 2 ? 'Unidad 02' : 'Unidad 01',
        'Lectura cruda HX711': 84213 + Math.round(bruto * 21450),
        'Peso bruto (kg)': bruto,
        'Tara (kg)': config.taraKg,
        'Densidad (kg/L)': config.densidad,
        'Turbidez (NTU)': ntu,
        'Precio por litro': config.precioLitro,
        'Estado': 'Pagada',
        'Canal de confirmación': canal,
        'Fecha de validación': validacion.toISOString(),
        'Fecha de abono': abono.toISOString(),
        'Clave de rastreo': `OLEO${marca(abono)}${1000 + ((i + 3) * 3571) % 9000}`
      }
    };
  });

  const solicitudes = SOLICITUDES.map(([p, nivel]) => ({ puesto: p, fields: { 'Nivel (%)': nivel, 'Estado': 'Pendiente' } }));

  return { puestos, solicitudes, recolecciones };
}
