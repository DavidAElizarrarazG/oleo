// Comprobante por WhatsApp con enlace click-to-chat (wa.me): abre WhatsApp con el mensaje
// ya escrito para el número del puesto. Sin API ni credenciales; la persona solo toca Enviar.
// El envío automático (WhatsApp Business API desde Make) queda para el piloto.

import { baseUrl } from './qr.js';
import { fmtNum, fmtL, fmtMoneda, fmtClave } from './util.js';

// 10 dígitos de México -> 52XXXXXXXXXX. Acepta también números que ya traen 52 o 521.
export function numeroWhatsApp(telefono) {
  const d = String(telefono || '').replace(/\D/g, '');
  if (d.length === 10) return `52${d}`;
  if (/^52\d{10}$/.test(d) || /^521\d{10}$/.test(d)) return d;
  return '';
}

export function mensajePago(r, nombre) {
  return [
    `Hola${nombre ? `, ${nombre}` : ''}. OLEO recibió tu aceite usado.`,
    '',
    `Folio: ${r.folio}`,
    `Litros: ${fmtL(r.litros)}`,
    `Pago: *${fmtMoneda(r.monto)}* (transferencia SPEI simulada)`,
    `Clave de rastreo: ${fmtClave(r.clave)}`,
    `Agua protegida: ${fmtNum(r.agua)} L`,
    '',
    `Tu constancia: ${baseUrl()}#/constancia/${r.id}`
  ].join('\n');
}

// Sin número válido, wa.me deja elegir el contacto.
export const enlaceWhatsApp = (telefono, texto) =>
  `https://wa.me/${numeroWhatsApp(telefono)}?text=${encodeURIComponent(texto)}`;
