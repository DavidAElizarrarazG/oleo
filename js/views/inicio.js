// Inicio (#/): lo que abre el QR de la portada. No llama a Make al cargar.

import { sesionPuesto } from '../api.js';
import { modoEfectivo, obtenerConfig, VERSION } from '../config.js';
import { esc } from '../util.js';
import { garrafon } from './componentes.js';

export default async function inicio({ raiz }) {
  const sesion = sesionPuesto();
  const c = obtenerConfig();
  const local = modoEfectivo(c) === 'local';
  raiz.innerHTML = `
    <section class="portada">
      <h1>Tu aceite usado vale dinero.</h1>
      <div aria-hidden="true">${garrafon(70)}</div>
      <p>Te damos un bote hermético, pasamos por él en la noche y te pagamos al momento.</p>
    </section>

    <div class="pila">
      ${sesion
        ? `<a class="btn btn-primario" href="#/comerciante">Ir a mi puesto</a>
           <p class="chico secundario centro">${esc(sesion.nombre)}, ${esc(sesion.puestoId)}</p>`
        : '<a class="btn btn-primario" href="#/comerciante/alta">Registrar mi puesto</a>'}
      ${sesion ? '' : '<a class="btn btn-secundario" href="#/comerciante/entrar">Ya tengo puesto</a>'}
      <div class="dos">
        <a class="btn btn-secundario" href="#/recolector">Soy recolector</a>
        <a class="btn btn-secundario" href="#/impacto">Ver impacto</a>
      </div>
    </div>

    <section class="seccion" aria-labelledby="como-funciona">
      <h2 id="como-funciona">Cómo funciona</h2>
      <ol class="pasos">
        <li>Registra tu puesto.</li>
        <li>Avisa cuando tu bote esté lleno.</li>
        <li>Cobra al entregar.</li>
      </ol>
      <p class="nota">Pasamos de ${esc(c.ventana)}. Cada litro que no va al drenaje protege 1,000 litros de agua.</p>
    </section>

    ${local ? `<div class="panel pila-chica">
      <p class="fuerte">Modo local</p>
      <p class="chico secundario">${c.webhook ? 'Elegiste el modo local.' : 'Falta la URL del webhook de Make.'} Los datos se guardan solo en este teléfono.</p>
    </div>` : ''}

    <footer class="pie chico secundario">
      <span>Pago simulado para fines del prototipo. v${VERSION}</span>
      <a href="#/config" class="btn-texto">Ajustes</a>
    </footer>`;
}
