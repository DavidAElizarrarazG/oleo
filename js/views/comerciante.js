// Vistas del comerciante (sección 10.5) y destino del QR del bote (10.6).

import * as api from '../api.js';
import { obtenerConfig, TIPOS_NEGOCIO } from '../config.js';
import { ALCALDIAS, puntoCercano } from '../route.js';
import { impactoTotal } from '../metrics.js';
import { qrSVG, urlPuesto, descargarEtiqueta } from '../qr.js';
import { $, esc, fmtNum, fmtL, fmtKg, fmtMoneda, fmtFecha, fmtClave, fmtSeg, fmtKB, pinAleatorio, aviso, confirmar, sondear, icono } from '../util.js';
import { garrafon, actualizarGarrafon, medidorDatos, botonActualizar, mensajeError } from './componentes.js';

// ---------- Alta del puesto ----------
export async function alta({ raiz, ir }) {
  const opciones = (lista) => lista.map((x) => `<option>${esc(x)}</option>`).join('');
  raiz.innerHTML = `
    <div class="encabezado">
      <h1>Registrar mi puesto</h1>
      <p class="secundario">Tarda menos de un minuto. Te damos un bote hermético de 20 L en comodato.</p>
    </div>
    <form id="form-alta" class="pila" novalidate>
      <div class="campo">
        <label for="f-nombre">Nombre del puesto</label>
        <input id="f-nombre" name="nombre" required autocomplete="organization" maxlength="80" placeholder="Ej. Tacos El Güero">
      </div>
      <div class="campo">
        <label for="f-tipo">Tipo de negocio</label>
        <select id="f-tipo" name="tipo" required><option value="">Elige una opción</option>${opciones(TIPOS_NEGOCIO)}</select>
      </div>
      <div class="campo">
        <label for="f-alcaldia">Alcaldía</label>
        <select id="f-alcaldia" name="alcaldia" required><option value="">Elige tu alcaldía</option>${opciones(ALCALDIAS.map((a) => a.nombre))}</select>
      </div>
      <div class="campo">
        <label for="f-colonia">Colonia <span class="opcional">(opcional)</span></label>
        <input id="f-colonia" name="colonia" maxlength="80" autocomplete="address-level3">
      </div>
      <div class="campo">
        <label for="f-cierre">Hora de cierre</label>
        <input id="f-cierre" name="cierre" type="time" value="20:00" required>
      </div>
      <div class="campo">
        <label for="f-responsable">Responsable <span class="opcional">(opcional)</span></label>
        <input id="f-responsable" name="responsable" maxlength="60" autocomplete="name">
      </div>
      <div class="campo">
        <label for="f-whatsapp">WhatsApp <span class="opcional">(opcional, 10 dígitos)</span></label>
        <input id="f-whatsapp" name="whatsapp" type="tel" inputmode="numeric" maxlength="14" autocomplete="tel-national" aria-describedby="ayuda-whatsapp">
        <span class="ayuda" id="ayuda-whatsapp">Para mandarte tu comprobante de pago.</span>
      </div>
      <div class="campo">
        <span class="rotulo">Ubicación del puesto</span>
        <button type="button" class="btn btn-secundario" id="btn-ubicacion">Usar mi ubicación</button>
        <p class="ayuda" id="estado-ubicacion">Si no la compartes, usamos un punto aproximado de tu alcaldía.</p>
      </div>
      <p class="nota">Usamos estos datos solo para programar la recolección y emitir tus constancias.</p>
      <div id="error-alta" role="alert"></div>
      <button class="btn btn-primario" type="submit" id="btn-registrar">Registrar mi puesto</button>
    </form>`;

  let ubicacion = null;
  $('#btn-ubicacion', raiz).addEventListener('click', () => {
    const estado = $('#estado-ubicacion', raiz);
    if (!navigator.geolocation) { estado.textContent = 'Este teléfono no comparte ubicación. Usaremos un punto de tu alcaldía.'; return; }
    estado.textContent = 'Buscando tu ubicación';
    navigator.geolocation.getCurrentPosition(
      (p) => {
        ubicacion = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) };
        estado.textContent = `Ubicación guardada (precisión de ${fmtNum(p.coords.accuracy)} m).`;
      },
      () => { estado.textContent = 'No pudimos obtener tu ubicación. Usaremos un punto de tu alcaldía.'; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });

  $('#form-alta', raiz).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const datos = Object.fromEntries(new FormData(f));
    const errores = [];
    const marcar = (campo, malo) => f.elements[campo].setAttribute('aria-invalid', malo ? 'true' : 'false');
    marcar('nombre', !datos.nombre.trim()); if (!datos.nombre.trim()) errores.push('Escribe el nombre del puesto.');
    marcar('tipo', !datos.tipo); if (!datos.tipo) errores.push('Elige el tipo de negocio.');
    marcar('alcaldia', !datos.alcaldia); if (!datos.alcaldia) errores.push('Elige tu alcaldía.');
    const tel = (datos.whatsapp || '').replace(/\D/g, '');
    marcar('whatsapp', tel && tel.length !== 10); if (tel && tel.length !== 10) errores.push('El WhatsApp debe tener 10 dígitos.');
    const zonaError = $('#error-alta', raiz);
    if (errores.length) {
      zonaError.innerHTML = `<p class="mensaje-error">${errores.map(esc).join('<br>')}</p>`;
      f.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    zonaError.innerHTML = '';
    const pos = ubicacion || puntoCercano(datos.alcaldia, 600);
    const btn = $('#btn-registrar', raiz);
    btn.disabled = true;
    btn.textContent = 'Registrando tu puesto';
    try {
      const puesto = await api.altaPuesto({
        nombre: datos.nombre.trim(), tipo: datos.tipo, alcaldia: datos.alcaldia, colonia: datos.colonia.trim(),
        cierre: datos.cierre || '20:00', responsable: datos.responsable.trim(), whatsapp: tel,
        lat: pos.lat, lng: pos.lng, pin: pinAleatorio()
      });
      api.guardarSesion(puesto);
      api.guardarSolicitudLocal(null);
      ir('#/comerciante/listo');
    } catch (err) {
      zonaError.innerHTML = mensajeError(err);
      btn.disabled = false;
      btn.textContent = 'Registrar mi puesto';
    }
  });
}

// ---------- Alta completada ----------
export async function listo({ raiz, ir }) {
  const s = api.sesionPuesto();
  if (!s) return ir('#/comerciante/alta', { reemplazar: true });
  raiz.innerHTML = `
    <div class="encabezado">
      <h1>Tu puesto ${esc(s.puestoId)} quedó registrado.</h1>
      <p class="secundario">${esc(s.nombre)}</p>
    </div>
    <div class="qr-caja" id="qr-puesto"><p class="cargando">Generando QR</p></div>
    <p class="chico secundario centro">Este QR va en la etiqueta de tu bote. El recolector lo escanea al pasar.</p>
    <section class="panel pila-chica" aria-labelledby="titulo-pin">
      <h2 id="titulo-pin" class="grande">Tu PIN</h2>
      <p class="pin-grande" id="pin">${esc(s.pin)}</p>
      <p>Guárdalo. Si un día no tienes datos, se lo dices al recolector para confirmar.</p>
    </section>
    <p>Te entregaremos un bote hermético de 20 L en comodato.</p>
    <div class="pila">
      <button class="btn btn-secundario" id="btn-etiqueta">Descargar etiqueta del bote</button>
      <a class="btn btn-primario" href="#/comerciante">Ir a mi puesto</a>
    </div>`;
  $('#qr-puesto', raiz).innerHTML = await qrSVG(urlPuesto(s.puestoId, s.id), { titulo: `QR del puesto ${s.puestoId}` });
  $('#btn-etiqueta', raiz).addEventListener('click', () => descargarEtiqueta(s).catch((e) => aviso(e.message, 'error')));
}

// ---------- Entrar con Puesto ID + PIN ----------
export async function entrar({ raiz, query, ir }) {
  raiz.innerHTML = `
    <div class="encabezado">
      <h1>Entrar a mi puesto</h1>
      <p class="secundario">Usa el Puesto ID de tu etiqueta y tu PIN de 4 dígitos.</p>
    </div>
    <form id="form-entrar" class="pila" novalidate>
      <div class="campo">
        <label for="e-id">Puesto ID</label>
        <input id="e-id" name="puestoId" required autocapitalize="characters" placeholder="OLEO-0007" value="${esc(query.p || '')}">
      </div>
      <div class="campo">
        <label for="e-pin">PIN</label>
        <input id="e-pin" name="pin" required inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="one-time-code">
      </div>
      <div id="error-entrar" role="alert"></div>
      <button class="btn btn-primario" type="submit" id="btn-entrar">Entrar</button>
      <a class="btn-texto centro" href="#/comerciante/alta">Aún no tengo puesto: registrarlo</a>
    </form>`;
  if (query.p) $('#e-pin', raiz).focus();
  $('#form-entrar', raiz).addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.target));
    const id = normalizarPuestoId(datos.puestoId);
    const zona = $('#error-entrar', raiz);
    if (!id || !/^\d{4}$/.test(datos.pin)) { zona.innerHTML = '<p class="mensaje-error">El Puesto ID o el PIN no coinciden.</p>'; return; }
    const btn = $('#btn-entrar', raiz);
    btn.disabled = true;
    try {
      const p = await api.buscarPuesto(id);
      if (!p || p.pin !== datos.pin) {
        zona.innerHTML = '<p class="mensaje-error">El Puesto ID o el PIN no coinciden.</p>';
        btn.disabled = false;
        return;
      }
      api.guardarSesion(p);
      api.guardarSolicitudLocal(await api.solicitudPendienteDe(p.puestoId).catch(() => null));
      ir('#/comerciante');
    } catch (err) {
      zona.innerHTML = mensajeError(err);
      btn.disabled = false;
    }
  });
}

export function normalizarPuestoId(t) {
  const s = String(t || '').trim().toUpperCase();
  const m = s.match(/^(?:OLEO-?)?(\d{1,6})$/);
  return m ? `OLEO-${m[1].padStart(4, '0')}` : null;
}

// ---------- Mi puesto ----------
export async function miPuesto({ raiz, senal, ir }) {
  const sesion = api.sesionPuesto();
  if (!sesion) return ir('#/comerciante/alta', { reemplazar: true });
  const c = obtenerConfig();
  const e = {
    recs: [],
    cargado: false,
    exito: null,          // pago recién hecho en este teléfono
    rechazada: null,      // folio rechazado en este teléfono
    error: null,
    nivel: Number(localStorage.getItem('oleo.nivel') || 50),
    procesando: false
  };

  raiz.innerHTML = `
    <div class="fila-entre">
      <div class="encabezado">
        <h1>${esc(sesion.nombre)}</h1>
        <p class="secundario">${esc(sesion.puestoId)}, ${esc(sesion.alcaldia || '')}</p>
      </div>
      <button class="btn-chico" id="btn-ver-qr" aria-expanded="false">${icono('qr')}QR</button>
    </div>
    <div id="zona-qr" class="qr-caja" hidden></div>
    <div id="zona-confirmar"></div>
    <a class="btn btn-secundario" href="#/asistente">${icono('chat')}Preguntarle al asistente</a>
    <section class="seccion" aria-labelledby="titulo-bote">
      <h2 id="titulo-bote">Nivel del bote</h2>
      <div class="bote">
        <div id="garrafon">${garrafon(e.nivel)}</div>
        <div class="pila">
          <div class="bote-nivel" id="nivel-texto">${e.nivel}%</div>
          <label class="chico secundario" for="nivel">Mueve la barra según qué tan lleno está</label>
          <input type="range" id="nivel" min="0" max="100" step="5" value="${e.nivel}">
        </div>
      </div>
      <button class="btn btn-primario" id="btn-avisar">Avisar que mi bote está lleno</button>
      <p class="chico secundario" id="nota-aviso" aria-live="polite"></p>
    </section>
    <section class="seccion" aria-labelledby="titulo-saldo">
      <h2 id="titulo-saldo">Mi saldo y mi impacto</h2>
      <div id="zona-saldo"></div>
    </section>
    <section class="seccion" aria-labelledby="titulo-constancias">
      <h2 id="titulo-constancias">Mis constancias</h2>
      <div id="zona-constancias"><p class="cargando">Cargando</p></div>
    </section>
    <div class="pie">
      ${medidorDatos(null)}
      ${botonActualizar()}
    </div>`;

  const medidor = (bytes) => { $('#medidor', raiz).textContent = `Esta operación usó ${fmtKB(bytes)} de datos`; };

  // QR del puesto en pantalla (por si el recolector escanea el teléfono).
  $('#btn-ver-qr', raiz).addEventListener('click', async (ev) => {
    const zona = $('#zona-qr', raiz);
    const abrir = zona.hidden;
    zona.hidden = !abrir;
    ev.currentTarget.setAttribute('aria-expanded', String(abrir));
    if (abrir && !zona.innerHTML) zona.innerHTML = await qrSVG(urlPuesto(sesion.puestoId, sesion.id), { titulo: `QR del puesto ${sesion.puestoId}` });
  });

  // ----- Nivel y aviso -----
  const slider = $('#nivel', raiz);
  slider.addEventListener('input', () => {
    e.nivel = Number(slider.value);
    $('#nivel-texto', raiz).textContent = `${e.nivel}%`;
    actualizarGarrafon($('#garrafon svg', raiz), e.nivel);
    try { localStorage.setItem('oleo.nivel', String(e.nivel)); } catch { /* sin almacenamiento */ }
  });

  function pintarAviso() {
    const sol = api.solicitudLocal();
    const btn = $('#btn-avisar', raiz);
    const nota = $('#nota-aviso', raiz);
    if (sol) {
      btn.disabled = true;
      btn.textContent = 'Ya avisaste; pasamos hoy';
      nota.textContent = sol.pendiente
        ? 'Sin señal. Tu aviso quedó guardado en este teléfono y se enviará solo al recuperar conexión.'
        : `Pasamos por tu bote hoy entre ${c.ventana}.`;
    } else {
      btn.disabled = false;
      btn.textContent = 'Avisar que mi bote está lleno';
      nota.textContent = 'Recomendado desde 80%.';
    }
  }

  $('#btn-avisar', raiz).addEventListener('click', async () => {
    if (e.nivel < 80) {
      const ok = await confirmar(`Tu bote está al ${e.nivel}%. Recomendamos avisar desde 80%. ¿Avisar de todos modos?`, { aceptar: 'Sí, avisar' });
      if (!ok) return;
    }
    const btn = $('#btn-avisar', raiz);
    btn.disabled = true;
    btn.textContent = 'Enviando aviso';
    try {
      const [s, bytes] = await api.medir(() => api.solicitar(sesion.id, e.nivel));
      medidor(bytes);
      api.guardarSolicitudLocal(s);
      sondeo.iniciar();
    } catch (err) {
      aviso(err.message, 'error');
    }
    pintarAviso();
  });

  // ----- Recolección por confirmar y cobro -----
  const porConfirmar = () => e.recs.find((r) => r.estado === 'Por confirmar');

  function pintarConfirmar() {
    const zona = $('#zona-confirmar', raiz);
    if (e.exito) {
      const p = e.exito;
      zona.innerHTML = `<section class="panel panel-exito pila cobro-ok" aria-live="polite">
        <p class="fuerte">Recibiste</p>
        <p class="cifra-monto">${fmtMoneda(p.monto)}</p>
        <div class="pila-chica">
          <p class="chico secundario">Clave de rastreo</p>
          <p class="mono fuerte">${esc(fmtClave(p.claveRastreo))}</p>
        </div>
        <p>Esta entrega protegió <strong>${fmtNum(p.agua)}&nbsp;L de agua</strong>.</p>
        <p>Tu confirmación se convirtió en abono en <strong>${fmtSeg(p.latenciaMs / 1000)}</strong>.</p>
        <p class="chico secundario">Transferencia ${esc(p.rail)} simulada (${esc(p.institucion)}).</p>
        <a class="btn btn-exito" href="#/constancia/${esc(p.recoleccionId)}">Ver constancia</a>
      </section>`;
      return;
    }
    const r = porConfirmar();
    if (r) {
      zona.innerHTML = `<section class="panel panel-destacado pila por-confirmar" aria-labelledby="titulo-confirmar">
        <h2 id="titulo-confirmar" class="grande">Recolección por confirmar</h2>
        <p>El recolector registró <strong>${fmtL(r.litros)}</strong> (${fmtKg(r.netoKg)} netos). Pago: <strong>${fmtMoneda(r.monto)}</strong>. ¿Coincide con lo que entregaste?</p>
        <p class="chico secundario">${esc(r.folio)}. Recibirás el pago por transferencia SPEI simulada.</p>
        <div id="error-cobro" role="alert"></div>
        <button class="btn btn-primario" id="btn-cobrar">Confirmar y cobrar</button>
        <button class="btn btn-secundario" id="btn-no-coincide">No coincide</button>
      </section>`;
      $('#btn-cobrar', zona).addEventListener('click', () => cobrar(r));
      $('#btn-no-coincide', zona).addEventListener('click', () => noCoincide(r));
      return;
    }
    if (e.rechazada) {
      zona.innerHTML = `<div class="panel pila-chica"><p class="fuerte">Avisamos al recolector para volver a pesar.</p>
        <p class="chico secundario">${esc(e.rechazada)} quedó como no coincide. Cuando registre el nuevo peso aparecerá aquí.</p></div>`;
      return;
    }
    zona.innerHTML = '';
  }

  async function cobrar(r) {
    if (e.procesando) return;
    e.procesando = true;
    const btn = $('#btn-cobrar', raiz);
    btn.disabled = true;
    $('#btn-no-coincide', raiz).disabled = true;
    btn.textContent = 'Cobrando';
    try {
      const [pago, bytes] = await api.medir(() => api.pagar(r.id, sesion.pin, 'app'));
      medidor(bytes);
      e.exito = pago;
      Object.assign(r, { estado: 'Pagada', clave: pago.claveRastreo, fechaAbono: pago.fechaAbono, monto: pago.monto, litros: pago.litros, agua: pago.agua });
      pintarTodo();
    } catch (err) {
      const zona = $('#error-cobro', raiz);
      zona.innerHTML = `<p class="mensaje-error">${esc(err.message)}</p>`;
      btn.disabled = false;
      $('#btn-no-coincide', raiz).disabled = false;
      btn.textContent = err.tipo === 'red' || err.tipo === 'tiempo' ? 'Reintentar' : 'Confirmar y cobrar';
      if (err.tipo === 'conflicto') cargar().catch(() => {});
    } finally {
      e.procesando = false;
    }
  }

  async function noCoincide(r) {
    if (e.procesando) return;
    e.procesando = true;
    $('#btn-cobrar', raiz).disabled = true;
    $('#btn-no-coincide', raiz).disabled = true;
    try {
      const [rec, bytes] = await api.medir(() => api.rechazar(r.id));
      medidor(bytes);
      r.estado = rec.estado;
      e.rechazada = r.folio;
      pintarTodo();
      sondeo.iniciar();
    } catch (err) {
      $('#error-cobro', raiz).innerHTML = `<p class="mensaje-error">${esc(err.message)}</p>`;
      $('#btn-cobrar', raiz).disabled = false;
      $('#btn-no-coincide', raiz).disabled = false;
    } finally {
      e.procesando = false;
    }
  }

  // ----- Saldo y constancias -----
  function pintarSaldo() {
    const t = impactoTotal(e.recs);
    $('#zona-saldo', raiz).innerHTML = `<div class="resumen">
      <div><span class="valor">${fmtMoneda(t.pesos)}</span><span class="rotulo">pesos ganados</span></div>
      <div><span class="valor">${fmtNum(t.litros, 1)} L</span><span class="rotulo">litros entregados</span></div>
      <div><span class="valor">${fmtNum(t.agua)}</span><span class="rotulo">litros de agua protegidos</span></div>
    </div>`;
    const pagadas = e.recs.filter((r) => r.estado === 'Pagada');
    $('#zona-constancias', raiz).innerHTML = pagadas.length
      ? `<ul class="lista">${pagadas.map((r) => `<li><a class="fila-lista" href="#/constancia/${esc(r.id)}">
          <span><span class="fuerte">${esc(r.folio)}</span><br><span class="chico secundario">${fmtFecha(r.fechaAbono)}, ${fmtL(r.litros)}</span></span>
          <span class="fuerte">${fmtMoneda(r.monto)}</span></a></li>`).join('')}</ul>`
      : '<p class="secundario">Aún no tienes entregas pagadas. Cuando cobres, aquí aparece tu constancia.</p>';
  }

  function pintarTodo() { pintarConfirmar(); pintarAviso(); pintarSaldo(); }

  async function cargar() {
    const [recs, bytes] = await api.medir(async () => {
      const lista = await api.recoleccionesDe(sesion.puestoId);
      // ¿El aviso de este teléfono ya se atendió? Si hay una recolección posterior, sí.
      const sol = api.solicitudLocal();
      if (sol && !sol.pendiente && lista.some((r) => r.fechaValidacion && new Date(r.fechaValidacion) > new Date(sol.creada))) {
        api.guardarSolicitudLocal(null);
      }
      return lista;
    });
    if (senal.aborted) return true;
    e.recs = recs;
    e.cargado = true;
    if (porConfirmar()) { e.exito = null; e.rechazada = null; }
    pintarTodo();
    medidor(bytes);
    return !!porConfirmar(); // con una recolección por confirmar, deja de sondear
  }

  const sondeo = sondear({ cada: c.pollComercianteMs, max: c.pollComercianteMax, senal, fn: cargar });

  $('#btn-actualizar', raiz).addEventListener('click', async () => {
    const b = $('#btn-actualizar', raiz);
    b.disabled = true;
    try {
      if (!(await cargar())) sondeo.iniciar();
    } catch (err) { aviso(err.message, 'error'); } finally { b.disabled = false; }
  });

  // El aviso enviado desde la cola offline reemplaza al local.
  const quitarOyente = api.alCambiarCola((ev) => {
    if (ev.tipo === 'enviado' && ev.item.tipo === 'solicitar') { api.guardarSolicitudLocal(ev.registro); pintarAviso(); }
  });
  senal.addEventListener('abort', quitarOyente);

  pintarAviso();
  pintarSaldo();
  try {
    // Al abrir: verifica una vez el aviso guardado en el teléfono.
    const sol = api.solicitudLocal();
    if (sol && !sol.pendiente) {
      const s = await api.obtenerSolicitud(sol.id).catch(() => null);
      if (s && s.estado !== 'Pendiente') api.guardarSolicitudLocal(null);
    }
    if (!(await cargar())) sondeo.iniciar();
  } catch (err) {
    if (senal.aborted) return;
    $('#zona-confirmar', raiz).innerHTML = mensajeError(err);
    $('#zona-constancias', raiz).innerHTML = '';
  }
}

// ---------- Destino del QR del bote ----------
export async function destinoQR({ raiz, params, query }) {
  const puestoId = normalizarPuestoId(params.puestoId) || params.puestoId;
  raiz.innerHTML = '<p class="cargando">Buscando el puesto</p>';
  let p = null;
  try {
    if (query.r) p = await api.obtenerPuesto(query.r).catch(() => null);
    if (!p || p.puestoId !== puestoId) p = await api.buscarPuesto(puestoId);
  } catch (e) { console.error(e); }
  const recId = p?.id || query.r || '';
  const sesion = api.sesionPuesto();
  const esMio = sesion && sesion.puestoId === puestoId;
  const solicitud = api.cache.pendientes?.find((s) => s.puestoRecId === recId);
  const destinoPesar = `#/recolector/pesar/${encodeURIComponent(recId)}?p=${encodeURIComponent(puestoId)}${solicitud ? `&s=${solicitud.id}` : ''}`;
  raiz.innerHTML = `
    <div class="encabezado">
      <p class="secundario">Bote OLEO</p>
      <h1>${esc(p?.nombre || puestoId)}</h1>
      <p class="secundario">${esc(puestoId)}${p?.alcaldia ? `, ${esc(p.alcaldia)}` : ''}</p>
    </div>
    ${p ? '' : '<p class="nota">No pudimos consultar el puesto en este momento. Aun así puedes continuar.</p>'}
    <div class="pila">
      ${recId ? `<a class="btn btn-oscuro" href="${destinoPesar}">Soy el recolector: pesar este bote</a>` : ''}
      ${esMio
        ? '<a class="btn btn-primario" href="#/comerciante">Es mi puesto: ir a mi puesto</a>'
        : `<a class="btn btn-primario" href="#/comerciante/entrar?p=${encodeURIComponent(puestoId)}">Es mi puesto: entrar</a>`}
    </div>
    <p class="nota">Aceite vegetal usado. Mantener tapado. Entregar solo a recolector autorizado.</p>`;
}
