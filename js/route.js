// Ruteo de la ventana nocturna (sección 11.5): clúster por alcaldía + vecino más cercano.

// Apéndice B: centroides aproximados para ubicar puestos que no compartan su ubicación.
export const ALCALDIAS = [
  ['Álvaro Obregón', 19.3587, -99.2220],
  ['Azcapotzalco', 19.4869, -99.1847],
  ['Benito Juárez', 19.3727, -99.1580],
  ['Coyoacán', 19.3467, -99.1617],
  ['Cuajimalpa de Morelos', 19.3600, -99.2900],
  ['Cuauhtémoc', 19.4326, -99.1490],
  ['Gustavo A. Madero', 19.4900, -99.1100],
  ['Iztacalco', 19.3953, -99.0975],
  ['Iztapalapa', 19.3574, -99.0670],
  ['La Magdalena Contreras', 19.3175, -99.2430],
  ['Miguel Hidalgo', 19.4200, -99.1900],
  ['Milpa Alta', 19.1920, -99.0230],
  ['Tláhuac', 19.2860, -99.0050],
  ['Tlalpan', 19.2900, -99.1700],
  ['Venustiano Carranza', 19.4300, -99.1000],
  ['Xochimilco', 19.2620, -99.1050]
].map(([nombre, lat, lng]) => ({ nombre, lat, lng }));

export const ZOCALO = { lat: 19.4326, lng: -99.1332 };
export const FACTOR_URBANO = 1.3;

export function centroide(alcaldia) {
  return ALCALDIAS.find((a) => a.nombre === alcaldia) || ZOCALO;
}

// Punto dentro de un radio (m) alrededor del centroide de la alcaldía.
export function puntoCercano(alcaldia, radioM = 600) {
  const c = centroide(alcaldia);
  const r = radioM * Math.sqrt(Math.random());
  const ang = Math.random() * 2 * Math.PI;
  const dLat = (r * Math.cos(ang)) / 111320;
  const dLng = (r * Math.sin(ang)) / (111320 * Math.cos((c.lat * Math.PI) / 180));
  return { lat: +(c.lat + dLat).toFixed(6), lng: +(c.lng + dLng).toFixed(6) };
}

export function haversineKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const urbanaKm = (a, b) => haversineKm(a, b) * FACTOR_URBANO;

// solicitudes: [{ id, puestoRecId, lat, lng, alcaldia, ... }]
// Devuelve { paradas, clusters, totalKm, inicio }.
export function planearRuta(solicitudes, inicio = ZOCALO) {
  // Una parada por puesto (la solicitud más reciente gana).
  const porPuesto = new Map();
  for (const s of solicitudes) porPuesto.set(s.puestoRecId || s.id, s);
  const puntos = [...porPuesto.values()].map((s) => {
    const sinUbicacion = !Number.isFinite(s.lat) || !Number.isFinite(s.lng);
    const pos = sinUbicacion ? centroide(s.alcaldia) : { lat: s.lat, lng: s.lng };
    return { ...s, pos, sinUbicacion };
  });

  const grupos = new Map();
  for (const p of puntos) {
    const k = p.alcaldia || 'Sin alcaldía';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const clusters = [...grupos.entries()].map(([alcaldia, miembros]) => {
    const c = {
      lat: miembros.reduce((s, m) => s + m.pos.lat, 0) / miembros.length,
      lng: miembros.reduce((s, m) => s + m.pos.lng, 0) / miembros.length
    };
    return { alcaldia, miembros, centro: c, distanciaInicio: haversineKm(inicio, c) };
  }).sort((a, b) => a.distanciaInicio - b.distanciaInicio);

  const paradas = [];
  let actual = inicio;
  let totalKm = 0;
  for (const cl of clusters) {
    const restantes = [...cl.miembros];
    cl.paradas = [];
    while (restantes.length) {
      let mejor = 0;
      let mejorD = Infinity;
      restantes.forEach((p, i) => {
        const d = haversineKm(actual, p.pos);
        if (d < mejorD) { mejorD = d; mejor = i; }
      });
      const p = restantes.splice(mejor, 1)[0];
      const distanciaKm = urbanaKm(actual, p.pos);
      totalKm += distanciaKm;
      const parada = { ...p, orden: paradas.length + 1, cluster: cl.alcaldia, distanciaKm };
      paradas.push(parada);
      cl.paradas.push(parada);
      actual = p.pos;
    }
    delete cl.miembros;
  }
  return { paradas, clusters, totalKm, inicio };
}
