// Métricas verdes y monetización (Apéndice A). Las fórmulas son idénticas a las de Airtable (sección 6.3).

export const AGUA_POR_LITRO = 1000;     // L de agua protegidos por litro de aceite (factor del reto)
export const BIOCOMB_POR_LITRO = 0.9;   // L de combustible renovable por L de AVU (Repsol, 2025)
export const TINACO_L = 1100;           // tinaco doméstico estándar

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const pesoNeto = (brutoKg, taraKg) => r2(Math.max(0, Number(brutoKg) - Number(taraKg)));
export const litrosDesdeKg = (netoKg, densidad) => r2(Number(netoKg) / Number(densidad));
export const monto = (litros, precioLitro) => r2(Number(litros) * Number(precioLitro));
export const aguaProtegida = (litros) => Math.round(Number(litros) * AGUA_POR_LITRO);
export const biocombustible = (litros) => r2(Number(litros) * BIOCOMB_POR_LITRO);
export const calidad = (ntu, umbral) => (Number(ntu) <= Number(umbral) ? 'Aceptado' : 'Revisar');

export function derivar({ brutoKg, taraKg, densidad, precioLitro, ntu, umbral }) {
  const neto = pesoNeto(brutoKg, taraKg);
  const litros = litrosDesdeKg(neto, densidad);
  return { neto, litros, monto: monto(litros, precioLitro), agua: aguaProtegida(litros),
           bio: biocombustible(litros), calidad: calidad(ntu, umbral) };
}

export function impactoTotal(recolecciones) {
  const pagadas = recolecciones.filter((r) => r.estado === 'Pagada');
  const litros = r2(pagadas.reduce((s, r) => s + Number(r.litros || 0), 0));
  const pesos = r2(pagadas.reduce((s, r) => s + Number(r.monto || 0), 0));
  const t = pagadas.map((r) => Number(r.segundosAbono)).filter((n) => Number.isFinite(n) && n >= 0);
  return {
    recolecciones: pagadas.length, litros, pesos,
    agua: aguaProtegida(litros), bio: biocombustible(litros),
    tinacos: Math.floor(aguaProtegida(litros) / TINACO_L),
    promedioAbono: t.length ? r2(t.reduce((s, n) => s + n, 0) / t.length) : null
  };
}

// Texto que se sella: igual que sha256(Folio|Litros|Monto|claveRastreo) en Make.
// String(n) da punto decimal y sin ceros a la derecha, como Make al convertir números a texto.
export const textoSello = (folio, litros, montoPagado, clave) =>
  `${folio}|${String(litros)}|${String(montoPagado)}|${clave}`;
