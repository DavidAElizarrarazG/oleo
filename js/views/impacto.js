// Tablero de impacto (sección 10.9): métricas verdes agregadas sobre recolecciones pagadas.

import * as api from '../api.js';
import { obtenerConfig } from '../config.js';
import { impactoTotal, TINACO_L } from '../metrics.js';
import { $, esc, fmtNum, fmtL, fmtMoneda, fmtSeg, fmtHora, haceCuanto } from '../util.js';
import { botonActualizar, mensajeError } from './componentes.js';

const TINACO_SVG = '<svg viewBox="0 0 22 26" aria-hidden="true"><path d="M3 9.5C3 5.4 6.6 3 11 3s8 2.4 8 6.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor"/><rect x="8" y="1" width="6" height="3" rx="1" fill="currentColor"/><path d="M6 22v3M16 22v3" stroke="currentColor" stroke-width="2"/></svg>';

export default async function impacto({ raiz, senal }) {
  const c = obtenerConfig();
  raiz.innerHTML = `
    <div class="fila-entre">
      <div class="encabezado">
        <h1>Impacto</h1>
        <p class="chico secundario" id="hora-actualizacion">Consultando</p>
      </div>
      ${botonActualizar()}
    </div>
    <div id="contenido" class="pila-grande"><p class="cargando">Calculando métricas verdes</p></div>`;

  async function cargar() {
    const b = $('#btn-actualizar', raiz);
    b.disabled = true;
    try {
      const datos = await api.impacto();
      if (senal.aborted) return;
      pintar(datos);
      $('#hora-actualizacion', raiz).textContent = `Actualizado a las ${fmtHora()}`;
    } catch (e) {
      if (!senal.aborted) $('#contenido', raiz).innerHTML = mensajeError(e);
    } finally { b.disabled = false; }
  }

  function pintar({ recolecciones, puestos }) {
    const t = impactoTotal(recolecciones);
    const mostrados = Math.min(40, t.tinacos);
    $('#contenido', raiz).innerHTML = `
      <section class="heroe-agua pila-chica" aria-labelledby="titulo-agua">
        <p class="secundario" id="titulo-agua">Litros de agua protegidos</p>
        <p class="cifra">${fmtNum(t.agua)}</p>
        <p class="chico secundario">Cada litro de aceite que no llega al drenaje protege 1,000 litros de agua.</p>
        ${t.tinacos ? `<div class="tinacos" role="img" aria-label="Equivale a ${fmtNum(t.tinacos)} tinacos de ${fmtNum(TINACO_L)} litros">
          ${TINACO_SVG.repeat(mostrados)}${t.tinacos > 40 ? `<span class="chico secundario">y ${fmtNum(t.tinacos - 40)} más</span>` : ''}
        </div>
        <p class="chico">Equivale a <strong>${fmtNum(t.tinacos)} tinacos</strong> de ${fmtNum(TINACO_L)} L.</p>` : ''}
      </section>

      <section class="indicadores" aria-label="Indicadores">
        <div><span class="valor">${fmtNum(t.litros, 1)} L</span><span class="rotulo">aceite captado</span></div>
        <div><span class="valor">${fmtMoneda(t.pesos)}</span><span class="rotulo">pesos dispersados</span></div>
        <div><span class="valor">${fmtNum(t.bio, 1)} L</span><span class="rotulo">biocombustible potencial</span></div>
        <div><span class="valor">${fmtNum(puestos)}</span><span class="rotulo">puestos registrados</span></div>
        <div><span class="valor">${fmtNum(t.recolecciones)}</span><span class="rotulo">recolecciones pagadas</span></div>
        <div><span class="valor">${t.promedioAbono === null ? '-' : fmtSeg(t.promedioAbono)}</span><span class="rotulo">promedio del pesaje al abono</span></div>
      </section>

      <section class="seccion" aria-labelledby="titulo-grafica">
        <h2 id="titulo-grafica">Litros captados por día</h2>
        <p class="chico secundario">Últimos 7 días, según la fecha de abono.</p>
        ${grafica(porDia(recolecciones)) || '<p class="secundario">Sin litros captados en los últimos 7 días.</p>'}
      </section>

      <section class="seccion" aria-labelledby="titulo-actividad">
        <h2 id="titulo-actividad">Actividad reciente</h2>
        ${recolecciones.length ? `<ul class="lista">${recolecciones.slice(0, 8).map((r) => `<li>
          <a class="fila-lista" href="#/constancia/${esc(r.id)}">
            <span><span class="fuerte">${esc(r.folio)}</span> ${esc(r.nombre || r.puestoId || '')}<br>
            <span class="chico secundario">${esc(r.alcaldia || '')}, ${haceCuanto(r.fechaAbono)}</span></span>
            <span class="centro"><span class="fuerte">${fmtL(r.litros)}</span><br><span class="chico secundario">${fmtMoneda(r.monto)}</span></span>
          </a></li>`).join('')}</ul>` : '<p class="secundario">Aún no hay recolecciones pagadas.</p>'}
      </section>

      <footer class="nota pila-chica">
        <p>Fuentes: agua protegida con el factor del reto, 1 L de aceite por 1,000 L de agua (SEDEMA cita hasta 40,000 L; se usa el conservador). Biocombustible potencial de 0.9 L por litro de aceite usado (Repsol, 27 de octubre de 2025). Tinaco de referencia de 1,100 L, equivalencia ilustrativa. Densidad del aceite usado: 0.91 kg/L.</p>
        <p>Pagos simulados para fines del prototipo.</p>
      </footer>`;
    activarGrafica();
  }

  function activarGrafica() {
    const cont = $('.grafica-caja', raiz);
    if (!cont) return;
    const tip = $('.grafica-tip', cont);
    cont.querySelectorAll('.zona-barra').forEach((z) => {
      const mostrar = () => {
        tip.textContent = z.dataset.tip;
        tip.hidden = false;
        const caja = cont.getBoundingClientRect();
        const r = z.getBoundingClientRect();
        tip.style.left = `${Math.min(Math.max(r.left - caja.left + r.width / 2, 60), caja.width - 60)}px`;
      };
      z.addEventListener('pointerenter', mostrar);
      z.addEventListener('focus', mostrar);
      z.addEventListener('pointerleave', () => { tip.hidden = true; });
      z.addEventListener('blur', () => { tip.hidden = true; });
    });
  }

  $('#btn-actualizar', raiz).addEventListener('click', cargar);
  if (c.impactoAutoMs > 0) {
    const id = setInterval(() => { if (!document.hidden) cargar(); }, Math.max(5000, c.impactoAutoMs));
    senal.addEventListener('abort', () => clearInterval(id));
  }
  await cargar();
}

// Litros por día (fecha local de abono), últimos 7 días incluyendo hoy.
function porDia(recolecciones) {
  const dias = [];
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    dias.push({ fecha: d, clave: d.toDateString(), litros: 0 });
  }
  const indice = new Map(dias.map((d) => [d.clave, d]));
  for (const r of recolecciones) {
    if (!r.fechaAbono) continue;
    const d = indice.get(new Date(r.fechaAbono).toDateString());
    if (d) d.litros += Number(r.litros || 0);
  }
  return dias;
}

const fDia = new Intl.DateTimeFormat('es-MX', { weekday: 'short' });
const fDiaLargo = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });

// Columnas SVG hechas a mano: una serie, una sola escala, etiqueta solo en el máximo y tooltip por barra.
function grafica(dias) {
  const W = 340;
  const H = 170;
  const arriba = 22;
  const abajo = 26;
  const base = H - abajo;
  const altoUtil = base - arriba;
  const slot = W / dias.length;
  const ancho = Math.min(24, slot * 0.5);
  const max = Math.max(...dias.map((d) => d.litros));
  if (max <= 0) return '';
  const escala = max > 0 ? altoUtil / max : 0;
  const iMax = dias.findIndex((d) => d.litros === max);
  const radio = 4;

  const barras = dias.map((d, i) => {
    const x = i * slot + (slot - ancho) / 2;
    const h = d.litros * escala;
    const etiqueta = `${fDia.format(d.fecha).replace('.', '')}`;
    const tip = `${fDiaLargo.format(d.fecha)}: ${fmtNum(d.litros, 1)} L`;
    let barra = '';
    if (h > 0) {
      const r = Math.min(radio, h, ancho / 2);
      // Extremo de datos redondeado (4 px), cuadrado en la línea base.
      barra = `<path class="barra-dato" d="M${x} ${base}V${base - h + r}Q${x} ${base - h} ${x + r} ${base - h}H${x + ancho - r}Q${x + ancho} ${base - h} ${x + ancho} ${base - h + r}V${base}Z"/>`;
    }
    const valor = i === iMax && max > 0 ? `<text class="valor-barra" x="${x + ancho / 2}" y="${base - h - 6}" text-anchor="middle">${fmtNum(d.litros, 1)} L</text>` : '';
    return `<g>
      ${barra}${valor}
      <text x="${i * slot + slot / 2}" y="${H - 8}" text-anchor="middle">${esc(etiqueta)}</text>
      <rect class="zona-barra" x="${i * slot}" y="0" width="${slot}" height="${H}" fill="transparent" tabindex="0" role="img" aria-label="${esc(tip)}" data-tip="${esc(tip)}"/>
    </g>`;
  }).join('');

  return `<div class="grafica-caja">
    <svg class="grafica" viewBox="0 0 ${W} ${H}" role="group" aria-label="Litros captados por día, últimos 7 días">
      <line class="base" x1="0" x2="${W}" y1="${base}" y2="${base}"/>
      ${barras}
    </svg>
    <div class="grafica-tip" hidden></div>
  </div>`;
}
