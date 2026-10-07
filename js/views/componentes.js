// Piezas de interfaz compartidas entre vistas.

import { esc, fmtNum, fmtKg, fmtL, fmtMoneda, fmtClave, bloques, fmtKB, icono } from '../util.js';

// Garrafón de 20 L que se llena de ámbar. nivel: 0 a 100.
export function garrafon(nivel = 0, { titulo = 'Nivel del bote' } = {}) {
  const alto = 92;
  const h = (alto * Math.max(0, Math.min(100, nivel))) / 100;
  return `<svg class="garrafon" viewBox="0 0 100 130" role="img" aria-label="${esc(titulo)}: ${Math.round(nivel)}%">
    <defs><clipPath id="interior-garrafon"><rect x="17" y="31" width="66" height="92" rx="8"/></clipPath></defs>
    <rect class="tapa" x="19" y="6" width="24" height="9" rx="2"/>
    <rect class="tapa" x="23" y="13" width="16" height="17"/>
    <path class="asa" d="M52 12h24a6 6 0 0 1 6 6v12h-7v-9H59v9h-7z"/>
    <rect class="cuerpo" x="14" y="28" width="72" height="98" rx="10"/>
    <g clip-path="url(#interior-garrafon)">
      <rect class="nivel" x="17" y="${31 + alto - h}" width="66" height="${h}"/>
      <rect class="brillo" x="22" y="34" width="5" height="84" rx="2.5"/>
    </g>
    <g class="marcas"><line x1="74" x2="82" y1="54" y2="54"/><line x1="76" x2="82" y1="77" y2="77"/><line x1="74" x2="82" y1="100" y2="100"/></g>
  </svg>`;
}

export function actualizarGarrafon(svg, nivel) {
  const rect = svg.querySelector('.nivel');
  const h = (92 * Math.max(0, Math.min(100, nivel))) / 100;
  rect.setAttribute('y', 31 + 92 - h);
  rect.setAttribute('height', h);
  svg.setAttribute('aria-label', `Nivel del bote: ${Math.round(nivel)}%`);
}

// Panel "Del dato crudo al abono" (sección 10.10).
export function cadenaDato(r, { selloCompleto = false } = {}) {
  const pasos = [
    ['Lectura cruda HX711', `${fmtNum(r.raw)} cuentas`],
    ['Peso bruto', fmtKg(r.brutoKg)],
    [`Peso neto (tara ${fmtKg(r.taraKg)})`, fmtKg(r.netoKg)],
    [`Volumen (÷ ${fmtNum(r.densidad, 2)} kg/L)`, fmtL(r.litros)],
    [`Pago (x ${fmtMoneda(r.precio)}/L)`, fmtMoneda(r.monto)],
    ['Liquidación SPEI simulada', r.clave ? `clave ${fmtClave(r.clave)}` : 'pendiente'],
    ['Sello SHA-256', r.constancia ? (selloCompleto ? bloques(r.constancia) : `${bloques(r.constancia.slice(0, 16), 4)} ... (completo en la constancia)`) : 'pendiente']
  ];
  return `<section class="seccion" aria-labelledby="titulo-cadena">
    <h2 id="titulo-cadena">Del dato crudo al abono</h2>
    <ol class="cadena">
      ${pasos.map(([p, v]) => `<li><div class="paso">${esc(p)}</div><div class="valor-paso">${esc(v)}</div></li>`).join('')}
    </ol>
  </section>`;
}

export function metricasVerdes(r) {
  return `<div class="metricas-verdes">
    <div><div class="valor agua">${fmtNum(r.agua)} L</div><div class="chico secundario">de agua protegidos</div></div>
    <div><div class="valor bio">${fmtNum(r.bio, 2)} L</div><div class="chico secundario">de biocombustible potencial</div></div>
  </div>`;
}

export const medidorDatos = (bytes) =>
  `<p class="medidor" id="medidor">${bytes == null ? '' : `Esta operación usó ${fmtKB(bytes)} de datos`}</p>`;

export const botonActualizar = (id = 'btn-actualizar') =>
  `<button class="btn-chico" id="${id}">${icono('actualizar')}Actualizar</button>`;

export function mensajeError(e) {
  return `<div class="panel panel-alerta" role="alert"><p class="fuerte">${esc(e?.message || 'Algo salió mal.')}</p></div>`;
}
