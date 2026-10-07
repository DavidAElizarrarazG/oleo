// Constancia digital (sección 10.8): ticket térmico imprimible con sello SHA-256 verificable.

import * as api from '../api.js';
import { textoSello } from '../metrics.js';
import { $, esc, fmtNum, fmtKg, fmtL, fmtMoneda, fmtFechaTicket, fmtClave, bloques, sha256, icono } from '../util.js';
import { cadenaDato, mensajeError } from './componentes.js';

export default async function constancia({ raiz, params, senal }) {
  const id = params.id;
  let r = api.cache.recolecciones.get(id);
  if (!r || r.estado !== 'Pagada' || !r.constancia) {
    try { r = await api.obtenerRecoleccion(id); } catch (e) { raiz.innerHTML = mensajeError(e); return; }
  }
  if (senal.aborted) return;

  if (r.estado !== 'Pagada') {
    raiz.innerHTML = `<div class="encabezado"><h1>${esc(r.folio)}</h1></div>
      <div class="panel pila-chica"><p class="fuerte">Esta recolección aún no tiene abono.</p>
      <p class="chico secundario">Estado: ${esc(r.estado || '-')}. La constancia se emite al confirmar y cobrar.</p></div>`;
    return;
  }

  const pago = api.pagoLocal(id);
  const rail = pago ? `${pago.rail}, ${pago.institucion}` : 'SPEI, STP (simulado)';
  raiz.innerHTML = `
    <article class="ticket" aria-labelledby="titulo-constancia">
      <p class="marca-ticket">OLEO</p>
      <h1 id="titulo-constancia">Constancia de entrega de aceite vegetal usado</h1>
      <p class="mono fuerte">${esc(r.folio)}</p>
      <hr>
      <dl class="datos">
        <dt>Fecha de abono</dt><dd>${esc(fmtFechaTicket(r.fechaAbono))}</dd>
        <dt>Generador</dt><dd>${esc(r.puestoId || '-')}</dd>
        <dt>Nombre</dt><dd>${esc(r.nombre || '-')}</dd>
        <dt>Alcaldía</dt><dd>${esc(r.alcaldia || '-')}</dd>
        <dt>Recolector</dt><dd>${esc(r.recolector || '-')}</dd>
        <dt>Confirmación</dt><dd>${esc(r.canal || '-')}</dd>
      </dl>
      <hr>
      <dl class="datos">
        <dt>Peso bruto</dt><dd>${fmtKg(r.brutoKg)}</dd>
        <dt>Tara</dt><dd>${fmtKg(r.taraKg)}</dd>
        <dt>Peso neto</dt><dd>${fmtKg(r.netoKg)}</dd>
        <dt>Litros</dt><dd>${fmtL(r.litros)}</dd>
        <dt>Turbidez</dt><dd>${fmtNum(r.ntu, 1)} NTU</dd>
        <dt>Calidad</dt><dd>${esc(r.calidad || '-')}</dd>
        <dt>Monto</dt><dd>${fmtMoneda(r.monto)}</dd>
        <dt>Rail</dt><dd>${esc(rail)}</dd>
        <dt>Clave de rastreo</dt><dd>${esc(fmtClave(r.clave))}</dd>
      </dl>
      <hr>
      <dl class="datos">
        <dt>Agua protegida</dt><dd>${fmtNum(r.agua)} L</dd>
        <dt>Biocombustible potencial</dt><dd>${fmtNum(r.bio, 2)} L</dd>
      </dl>
      <hr>
      <p class="chico"><span class="fuerte">Destino declarado:</span> Centro de acopio de socio con registro RAMIR (por confirmar en el piloto).</p>
      <hr>
      <p class="fuerte">Sello digital (SHA-256)</p>
      <p class="sello">${esc(bloques(r.constancia))}</p>
      <p class="verificacion" id="verificacion" data-ok="">Verificando sello</p>
      <hr>
      <p class="leyenda">Documento generado automáticamente por OLEO conforme a la bitácora de entregas de la NADF-012-AMBT-2015. Pago simulado para fines del prototipo.</p>
    </article>
    <div class="pila no-imprimir">
      <button class="btn btn-primario" id="btn-imprimir">Guardar como PDF</button>
    </div>
    <div class="no-imprimir">${cadenaDato(r, { selloCompleto: false })}</div>`;

  $('#btn-imprimir', raiz).addEventListener('click', () => window.print());

  // Recalcula sha256(Folio|Litros|Monto|Clave) como lo hizo Make.
  const calculado = await sha256(textoSello(r.folio, r.litros, r.monto, r.clave));
  if (senal.aborted) return;
  const ok = calculado === String(r.constancia).toLowerCase();
  const v = $('#verificacion', raiz);
  v.dataset.ok = ok ? 'si' : 'no';
  v.innerHTML = ok ? `${icono('verificado')}Sello verificado` : `${icono('alerta')}El sello no coincide con los datos`;
  if (!ok) console.warn('Sello esperado', calculado, 'recibido', r.constancia, 'texto', textoSello(r.folio, r.litros, r.monto, r.clave));
}
