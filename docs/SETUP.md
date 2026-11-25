# OLEO: guía de configuración y despliegue para el equipo

Esta guía sigue la sección 14 de la especificación técnica del POC. Al terminar tendrán:

- La base **OLEO** en Airtable con 3 tablas, fórmulas, lookups y rollups.
- Dos escenarios activos en Make: **A "OLEO API"** (gateway de datos y orquestación del pago) y **B "OLEO API financiera simulada (SPEI/CoDi)"**.
- La PWA publicada en `https://<usuario>.github.io/oleo/`, instalada en dos teléfonos.
- El QR de la portada del reporte.

Tiempo estimado: 1.5 a 2 horas. Hagan los pasos en este orden.

> Regla de oro: los nombres de tablas, campos, rutas y parámetros se escriben **exactamente** como aparecen aquí, con acentos, mayúsculas y paréntesis. Si un nombre cambia, la integración se rompe.

---

## 0. Antes de empezar

Necesitan:

- Una computadora con **Node.js 20 o más reciente** (`node --version`) y **git**.
- Cuentas gratuitas en **Airtable**, **Make** y **GitHub** (de preferencia con el correo del equipo).
- Dos teléfonos con datos o un hotspot propio.

Instalen las herramientas del repositorio una sola vez:

```bash
npm install
```

```bash
npx playwright install chromium
```

### 0.1 Probar la app en modo local (sin cuentas, sin créditos)

```bash
node herramientas/servir.mjs
```

Abran `http://localhost:4173/`. Sin URL de webhook la app entra sola en **modo local**: todo el contrato de Make + Airtable corre dentro del navegador (`js/sim/make-airtable-sim.js`) y los datos viven en ese navegador. En `#/config` está **Cargar datos de ejemplo** para ver la ruta y el tablero con datos.

El modo local sirve para ensayar la interfaz sin gastar créditos y es el respaldo declarado si falla la red el día de la demo.

---

## 1. Airtable (30 a 40 min)

### 1.1 Base y BASE_ID

1. Entren a [airtable.com](https://airtable.com) y creen un workspace.
2. **Create › Start from scratch**. Nombre de la base: **OLEO**.
3. Con la base abierta, copien el `BASE_ID` de la URL del navegador: es el fragmento que empieza con `app`, por ejemplo `https://airtable.com/appAbC123xyz45678/...` → `appAbC123xyz45678`.

### 1.2 Personal Access Token

1. Avatar › **Builder hub › Personal access tokens › Create token**.
2. Nombre: `OLEO POC`.
3. Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`.
4. Access: **solo la base OLEO**.
5. **Create token** y cópienlo (empieza con `pat`). Solo se muestra una vez.

> El token **nunca** se sube al repositorio ni se pega en la PWA. Vive en Make (conexión de Airtable) y en variables de entorno al correr los scripts.

### 1.3 Crear tablas y campos con el script

En macOS o Linux:

```bash
AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node herramientas/crear-base-airtable.mjs
```

En Windows (PowerShell):

```bash
$env:AIRTABLE_TOKEN="pat..."; $env:AIRTABLE_BASE_ID="app..."; node herramientas/crear-base-airtable.mjs
```

El script crea las tablas **Puestos**, **Solicitudes** y **Recolecciones** con todos los campos marcados "script" en la sección 6 (incluidos los links **Puesto**; Airtable crea solo los inversos **Solicitudes** y **Recolecciones** en Puestos). Al final imprime la lista de campos manuales en el orden correcto. Si lo corren dos veces no duplica nada: solo agrega lo que falte.

Después, en Airtable:

- Borren la tabla vacía **Table 1** que Airtable crea con la base (clic derecho en la pestaña › Delete table).
- En **Solicitudes › Puesto** y **Recolecciones › Puesto** abran el campo (clic en la flecha del encabezado › Edit field) y verifiquen que **Allow linking to multiple records** esté apagado. El script intenta dejarlo así, pero algunas versiones de la API lo ignoran.

### 1.4 Campos manuales

Airtable no permite crear por API los campos de fórmula, autonumber, created time, lookup ni rollup. Agréguenlos a mano **en este orden** (el orden importa: las fórmulas usan campos que deben existir antes).

Cómo crear cada tipo en Airtable:

- **Campo nuevo:** botón **+** al final de los encabezados de la tabla › escriban el nombre › elijan el tipo › **Create field**.
- **Convertir el campo primario a fórmula:** clic en la flecha del primer encabezado (Puesto ID, Folio solicitud o Folio) › **Edit field** › tipo **Formula** › peguen la fórmula › **Save**. Háganlo después de crear **Num**.
- **Autonumber:** tipo **Autonumber**.
- **Created time:** tipo **Created time**, activen **Include time** y **Use the same time zone (GMT) for all collaborators**.
- **Lookup:** tipo **Lookup** › campo de link **Puesto** › campo a mostrar.
- **Rollup:** tipo **Rollup** › campo de link **Recolecciones** › campo a resumir › función `SUM(values)`.
- **Fórmula:** tipo **Formula** › peguen la fórmula tal cual. En **Monto** y **Pesos ganados**, en la pestaña **Formatting** elijan **Currency** (MXN, 2 decimales).

| # | Tabla | Campo | Tipo y configuración |
|---|---|---|---|
| 1 | Puestos | Num | Autonumber |
| 2 | Puestos | Puesto ID (primario) | Fórmula: `"OLEO-" & RIGHT("0000" & {Num}, 4)` |
| 3 | Puestos | Alta | Created time, con hora |
| 4 | Solicitudes | Num | Autonumber |
| 5 | Solicitudes | Folio solicitud (primario) | Fórmula: `"SOL-" & RIGHT("0000" & {Num}, 4)` |
| 6 | Solicitudes | Puesto ID | Lookup: Puesto › Puesto ID |
| 7 | Solicitudes | Nombre del puesto | Lookup: Puesto › Nombre del puesto |
| 8 | Solicitudes | Alcaldía | Lookup: Puesto › Alcaldía |
| 9 | Solicitudes | Cierre | Lookup: Puesto › Cierre |
| 10 | Solicitudes | Latitud | Lookup: Puesto › Latitud |
| 11 | Solicitudes | Longitud | Lookup: Puesto › Longitud |
| 12 | Solicitudes | Creada | Created time, con hora |
| 13 | Recolecciones | Num | Autonumber |
| 14 | Recolecciones | Folio (primario) | Fórmula: `"REC-" & RIGHT("0000" & {Num}, 4)` |
| 15 | Recolecciones | Puesto ID | Lookup: Puesto › Puesto ID |
| 16 | Recolecciones | Nombre del puesto | Lookup: Puesto › Nombre del puesto |
| 17 | Recolecciones | Alcaldía | Lookup: Puesto › Alcaldía |
| 18 | Recolecciones | PIN del puesto | Lookup: Puesto › PIN |
| 19 | Recolecciones | Peso neto (kg) | Fórmula: `ROUND(MAX({Peso bruto (kg)} - {Tara (kg)}, 0), 2)` |
| 20 | Recolecciones | Litros | Fórmula: `ROUND({Peso neto (kg)} / {Densidad (kg/L)}, 2)` |
| 21 | Recolecciones | Calidad | Fórmula: `IF({Turbidez (NTU)} <= 100, "Aceptado", "Revisar")` |
| 22 | Recolecciones | Monto | Fórmula: `ROUND({Litros} * {Precio por litro}, 2)` (formato moneda) |
| 23 | Recolecciones | Agua protegida (L) | Fórmula: `ROUND({Litros} * 1000, 0)` |
| 24 | Recolecciones | Biocombustible potencial (L) | Fórmula: `ROUND({Litros} * 0.9, 2)` |
| 25 | Recolecciones | Segundos al abono | Fórmula: `IF({Fecha de abono}, DATETIME_DIFF({Fecha de abono}, {Fecha de validación}, 'seconds'))` |
| 26 | Recolecciones | Litros pagados | Fórmula: `IF({Estado} = "Pagada", {Litros}, 0)` |
| 27 | Recolecciones | Monto pagado | Fórmula: `IF({Estado} = "Pagada", {Monto}, 0)` |
| 28 | Puestos | Litros entregados | Rollup: Recolecciones › Litros pagados, `SUM(values)` |
| 29 | Puestos | Pesos ganados | Rollup: Recolecciones › Monto pagado, `SUM(values)`, formato moneda |
| 30 | Puestos | Agua protegida (L) | Fórmula: `{Litros entregados} * 1000` |

El umbral `100` de **Calidad** debe coincidir con **Turbidez máxima aceptada** en `#/config` de la PWA.

### 1.5 Verificar

```bash
AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node herramientas/crear-base-airtable.mjs --verificar
```

Debe decir: "La base OLEO coincide con el contrato de la sección 6." Si lista pendientes (un campo con otro nombre, un tipo distinto o un primario que no es fórmula), corríjanlos y vuelvan a verificar.

### 1.6 Datos de ejemplo (opcional)

```bash
AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node herramientas/sembrar-airtable.mjs
```

Carga por API directa (no gasta créditos de Make) 6 puestos inventados, 2 solicitudes pendientes y 10 recolecciones pagadas en los últimos 7 días, con su sello SHA-256 válido. Los nombres son ficticios; no usen los de las personas entrevistadas.

---

## 2. Make (40 a 50 min)

Plan gratuito: 2 escenarios activos y 1,000 créditos al mes. Cada módulo ejecutado consume 1 crédito.

### 2.1 Cuenta y zona horaria

1. Creen la cuenta en [make.com](https://www.make.com). Anoten la región que aparece en las URLs (por ejemplo `us2`).
2. **Organization › Settings › Time zone:** `America/Mexico_City`. La clave de rastreo simulada usa esta hora.

### 2.2 Escenario B: "OLEO API financiera simulada (SPEI/CoDi)" (créenlo primero)

1. **Scenarios › Create a new scenario**. Nombre (arriba a la izquierda): `OLEO API financiera simulada (SPEI/CoDi)`.
2. Clic en el **+** grande › **Webhooks › Custom webhook** › **Add** › nombre `spei-sim` › **Save**. Copien la URL (**Copy address to clipboard**). Esta es la URL del Escenario B.
3. Agreguen **Webhooks › Webhook response** a la derecha del webhook:
   - **Status:** `200`
   - **Body:** peguen este texto. Make convierte cada `{{...}}` en una píldora; si alguna queda como texto, bórrenla y arrástrenla del panel de variables.

     ```
     {"estatus":"LIQUIDADA","rail":"SPEI","institucion":"STP (simulado)","claveRastreo":"OLEO{{formatDate(now; YYYYMMDDHHmmss)}}{{floor(random * 9000) + 1000}}","monto":{{1.monto}},"referencia":"{{1.referencia}}","beneficiario":"{{1.beneficiario}}","concepto":"{{1.concepto}}","fechaOperacion":"{{formatDate(now; YYYY-MM-DDTHH:mm:ssZ)}}"}
     ```

     En `formatDate` el formato va **sin comillas** (si se ponen, aparecen en el resultado).
   - **Show advanced settings › Custom headers:**
     - `Content-Type` = `application/json`
     - `Access-Control-Allow-Origin` = `*` (recomendado: permite que el botón **Probar API financiera** de la PWA lea la respuesta; el pago no lo necesita porque lo llama Make).
4. **Determinar la estructura de datos:** en el módulo webhook, **Redetermine data structure**. En la PWA (paso 3 o en `http://localhost:4173/#/config`) peguen la URL del Escenario B en **URL del Escenario B**, **Guardar** y pulsen **Probar API financiera**. Make debe mostrar **Successfully determined**. Ahora `monto`, `referencia`, `beneficiario` y `concepto` aparecen como píldoras.
5. **Save** (ícono de disco), activen el interruptor **Scheduling** en **ON** y elijan **Immediately**.

### 2.3 Escenario A: "OLEO API"

Creen un escenario nuevo con nombre `OLEO API`. Los números de módulo de abajo son los mismos de la sección 7.1; Make los asigna en el orden en que los agregan, así que agréguenlos en este orden.

**Módulo 1. Webhooks › Custom webhook**
- **Add** › nombre `oleo-api` › **Save**. Copien la URL: es la **URL del Escenario A** (la que va en `js/config.js`).
- La estructura de datos se determina en el paso 2.4.

**Módulo 2. Router** (Flow control › Router) a la derecha del webhook. Tendrá tres rutas: A "Datos", B "Pago" y C "No reconocida".

Para poner un filtro: clic en la línea punteada entre el router y el primer módulo de la ruta › **Set up a filter** › **Label** y condiciones. Los operadores están en **Text operators**. Varias condiciones en el mismo bloque se unen con **AND**.

**Ruta A "Datos"**

Filtro **Label:** `Solo operaciones permitidas`

| Campo | Operador | Valor |
|---|---|---|
| `{{1.accion}}` | Text operators: Equal to | `db` |
| `{{1.ruta}}` | Text operators: Matches pattern | `^(Puestos\|Solicitudes\|Recolecciones)(/(rec[A-Za-z0-9]{14}\|listRecords))?$` |
| `{{1.metodo}}` | Text operators: Matches pattern | `^(GET\|POST\|PATCH)$` |

(En Make escriban las barras verticales sin la diagonal invertida: `^(Puestos|Solicitudes|Recolecciones)(/(rec[A-Za-z0-9]{14}|listRecords))?$` y `^(GET|POST|PATCH)$`.)

**Módulo 3. Airtable › Make an API Call**
- **Connection:** **Add** › tipo **Airtable Personal Access Token** › peguen el token `pat...`.
- **URL:** `/v0/<BASE_ID>/{{1.ruta}}` (el BASE_ID real, por ejemplo `/v0/appAbC123xyz45678/{{1.ruta}}`).
- **Method:** activen **Map** (interruptor junto al campo) y mapeen `{{1.metodo}}`.
- **Headers:** **Add item** › Key `Content-Type`, Value `application/json`.
- **Body:** `{{1.cuerpo}}`
- **Manejador de error:** clic derecho sobre el módulo 3 › **Add error handler** › **Webhooks › Webhook response**:
  - Status `502`
  - Body `{"error":{"type":"AIRTABLE_ERROR","message":"Airtable rechazó la operación. Revisa el historial del escenario."}}`
  - Custom headers: `Content-Type` = `application/json` y `Access-Control-Allow-Origin` = `*`

**Módulo 4. JSON › Transform to JSON**
- **Object:** `{{3.body}}`

**Módulo 5. Webhooks › Webhook response**
- **Status:** `{{3.statusCode}}`
- **Body:** `{{4.json}}`
- **Custom headers:** `Content-Type` = `application/json` y `Access-Control-Allow-Origin` = `*`

**Ruta B "Pago"**

Filtro **Label:** `Pagar`. Condición: `{{1.accion}}` Text operators: Equal to `pagar`.

**Módulo 6. Airtable › Get a record**
- Connection: la misma. **Base:** OLEO. **Table:** Recolecciones.
- **Record ID:** `{{1.recoleccionId}}`

**Módulo 7. Router** con dos rutas:

*Ruta B1 "Válida".* Filtro **Label:** `Válida`, dos condiciones con AND:

| Campo | Operador | Valor |
|---|---|---|
| `{{6.Estado}}` | Text operators: Equal to | `Por confirmar` |
| `{{join(6.PIN del puesto; "")}}` | Text operators: Equal to | `{{1.pin}}` |

(La función `join` está en el panel de funciones, pestaña de arreglos; la píldora es el lookup **PIN del puesto** del módulo 6.)

**Módulo 8. HTTP › Make a request**
- **URL:** la URL del Escenario B.
- **Method:** `POST`
- **Body type / Body content type:** `application/x-www-form-urlencoded`
- **Fields** (Add item por cada uno):
  - `monto` = `{{6.Monto}}`
  - `referencia` = `{{6.Folio}}`
  - `beneficiario` = `{{first(6.Puesto ID)}}`
  - `concepto` = `Pago por acopio de aceite vegetal usado`
- **Parse response:** **Yes**

**Módulo 9. Airtable › Update a record**
- Base OLEO, tabla **Recolecciones**, **Record ID:** `{{6.ID}}`
- **Estado:** `Pagada`
- **Canal de confirmación:** activen **Map** y escriban `{{if(1.canal = "pin"; "PIN en sitio"; "App del comerciante")}}`
- **Fecha de abono:** `{{now}}`
- **Clave de rastreo:** `{{8.data.claveRastreo}}`
- **Constancia (SHA-256):** función `sha256( )` del panel de funciones de texto. Dentro de los paréntesis, sin espacios: píldora **Folio** (módulo 6), el carácter `|`, píldora **Litros** (6), `|`, píldora **Monto** (6), `|`, píldora **claveRastreo** (módulo 8). En texto plano queda `{{sha256(6.Folio|6.Litros|6.Monto|8.data.claveRastreo)}}`. La PWA recalcula exactamente ese texto para mostrar "Sello verificado".

**Módulo 10. Webhooks › Webhook response**
- Status `200`, mismos headers que el módulo 5.
- Body:

  ```
  {"ok":true,"recoleccionId":"{{9.ID}}","folio":"{{9.Folio}}","litros":{{9.Litros}},"monto":{{9.Monto}},"agua":{{9.`Agua protegida (L)`}},"claveRastreo":"{{9.`Clave de rastreo`}}","fechaAbono":"{{9.`Fecha de abono`}}","constancia":"{{9.`Constancia (SHA-256)`}}","institucion":"{{8.data.institucion}}","rail":"{{8.data.rail}}"}
  ```

*Ruta B2 "Rechazo".* Clic en la línea de la ruta › **Set up a filter** › activen **Fallback route: Yes** (sin condiciones).

**Módulo 11. Webhooks › Webhook response**
- Status `409`, mismos headers, Body `{"ok":false,"error":"La recolección ya fue pagada o el PIN no coincide."}`

**Ruta C "No reconocida"** (tercera salida del router 2): marquen **Fallback route: Yes**.

**Módulo 12. Webhooks › Webhook response**
- Status `400`, mismos headers, Body `{"ok":false,"error":"Acción no reconocida."}`

### 2.4 Determinar la estructura del webhook A

1. En el módulo 1, **Redetermine data structure** (Make queda escuchando).
2. En la PWA, `#/config`: peguen la URL del Escenario A en **URL del webhook del Escenario A**, **Guardar** y pulsen **Enviar muestra al webhook**.
3. Make muestra **Successfully determined** y ya ofrece las píldoras `accion`, `ruta`, `metodo`, `cuerpo`, `recoleccionId`, `pin`, `canal` y `mensajes`. Si configuraron los módulos antes de este paso, revisen que las píldoras sigan mapeadas.

### 2.5 Activar y probar

1. **Save**, **Scheduling: ON**, **Immediately** en los dos escenarios.
2. En `#/config` pulsen **Probar conexión**: debe responder **Status 200** con un JSON de Airtable.
3. **Enviar muestra al webhook** con el escenario activo responde `400 {"ok":false,"error":"Acción no reconocida."}`: es lo esperado (la muestra trae `accion=muestra` y cae en la ruta C).
4. En **History** del escenario A verán cada ejecución con sus módulos. Esa es la evidencia de "Zero-Friction Operations" para la demo.

### 2.6 Asistente del comerciante (ruta "Agente", 15 a 20 min)

El asistente de la pantalla **Mi puesto › Preguntarle al asistente** usa Claude. El ciclo de la conversación corre en la PWA; Make solo reenvía la conversación a la API de Claude, porque ahí vive la API key (nunca en el repositorio ni en la PWA). Make también fija el modelo (`claude-opus-5-5`), las instrucciones y las herramientas, para que el webhook no sirva para otra cosa.

**Antes:** una cuenta en [platform.claude.com](https://platform.claude.com) con saldo, y una API key (**Settings › API keys › Create key**). En **Settings › Limits** pongan un **límite de gasto mensual bajo** (por ejemplo 10 USD): la URL del webhook es pública y así nadie puede gastar más que eso.

**En Make, Escenario A:**

1. Si el router 2 ya tiene sus tres rutas, clic derecho en el router › **Add a route** (o arrastren una salida nueva). Filtro **Label:** `Agente`, condición `{{1.accion}}` Text operators: Equal to `agente`.
2. **Módulo 13. HTTP › Make a request**
   - **URL:** `https://api.anthropic.com/v1/messages`
   - **Method:** `POST`
   - **Headers:**
     - `x-api-key` = la API key de Anthropic (si su plan de Make tiene **Keychain**, guárdenla ahí)
     - `anthropic-version` = `2026-10-21`
     - `anthropic-beta` = `server-side-fallback-2026-07-01`
     - `content-type` = `application/json`
   - **Body type:** Raw, **Content type:** JSON (application/json)
   - **Request content:** corran `node herramientas/agente-make.mjs` y peguen **completo** el texto que imprime (también queda en `docs/make-agente-cuerpo.json`). Al final aparece `{{1.mensajes}}`: Make lo convierte en la píldora `mensajes` del webhook. No cambien nada más del texto.
   - **Parse response:** **No** (la respuesta debe llegar a la PWA tal cual, sin que Make la reacomode).
   - **Evaluate all states as errors:** **No** (así los errores de la API llegan a la PWA con su mensaje).
   - **Timeout:** 60 s.
3. **Módulo 14. Webhooks › Webhook response**
   - **Status:** `{{13.statusCode}}`
   - **Body:** `{{toString(13.data)}}`
   - **Custom headers:** `Content-Type` = `application/json` y `Access-Control-Allow-Origin` = `*`
4. **Redeterminen la estructura del webhook** (paso 2.4) para que aparezca la píldora `mensajes`: la muestra de `#/config` ya la incluye.
5. **Save** y prueben en `#/config` con **Probar asistente**: debe responder `claude-opus-5-5` con una frase.

Cada mensaje del modelo cuesta 3 créditos de Make (webhook, HTTP y respuesta). Un mensaje del comerciante usa de 1 a 3 llamadas al modelo, más las consultas a Airtable que hagan las herramientas (4 créditos cada una): una pregunta de saldo cuesta unos 10 créditos y un cobro desde el chat unos 20. En la API de Claude, cada llamada cuesta aproximadamente centavos de dólar (esfuerzo `low`).

**Qué puede hacer el asistente:** consultar el saldo, las recolecciones y los avisos (`consultar_mi_puesto`), avisar que el bote está lleno (`avisar_bote_lleno`) y mostrar la recolección por confirmar (`cobrar_recoleccion`). **El cobro siempre lo confirma el comerciante con el botón "Confirmar y cobrar" de la tarjeta**; la IA no puede disparar un pago sola, igual que la doble confirmación de la sección 11.4.

**Para probarlo sin Make** (con su propia API key, desde la computadora):

```bash
ANTHROPIC_API_KEY=sk-ant-... node herramientas/simulador-make.mjs --claude --ejemplo
```

y en `#/config` usen `http://localhost:8787/hook/oleo-api` como URL del Escenario A. Sin `--claude`, el simulador y el modo local responden con un modelo simulado (reconoce frases comunes y lo rotula como simulado).

### 2.7 Créditos

| Operación | Créditos aprox. |
|---|---|
| Cualquier consulta o escritura (`accion=db`) | 4 |
| Pago (`accion=pagar`): Escenario A 5 + Escenario B 2 | 7 |
| Cada llamada del asistente al modelo (`accion=agente`) | 3 |
| PIN incorrecto o pago repetido (409) | 3 |
| Ciclo completo de demo | 55 a 65 |

Con 1,000 créditos alcanzan unos 15 ciclos. Ensayen la interfaz en **modo local**, hagan 3 a 4 ensayos completos en la nube y tengan un seguro: un mes del plan Core (10.59 USD) o una segunda cuenta gratuita con los mismos escenarios. La URL del webhook se cambia en caliente desde `#/config`.

La pantalla **Abono ejecutado** del recolector consulta una vez el puesto para obtener su WhatsApp (4 créditos más por pago).

La app ya cuida los créditos: el comerciante consulta cada 8 s hasta 12 veces (se detiene al encontrar una recolección por confirmar), el recolector cada 5 s hasta 36 veces, el tablero solo al abrirlo o con **Actualizar**, y ninguna consulta se hace mientras la pestaña está oculta. Los intervalos se ajustan en `#/config`.

---

## 3. GitHub Pages (15 min)

1. En GitHub: **New repository** › nombre `oleo` › **Public** › **Create repository**.
2. Abran `js/config.js` y peguen la URL del Escenario A en `webhook` (y la del Escenario B en `apiFinanciera`):

   ```js
   webhook: 'https://hook.us2.make.com/xxxxxxxxxxxxxxxx',
   apiFinanciera: 'https://hook.us2.make.com/yyyyyyyyyyyyyyyy',
   ```

3. Suban el contenido de la carpeta `oleo/` (desde esa carpeta):

   ```bash
   git init
   ```

   ```bash
   git add . && git commit -m "OLEO POC Sprint 2"
   ```

   ```bash
   git branch -M main && git remote add origin https://github.com/<usuario>/oleo.git && git push -u origin main
   ```

   `node_modules/` no se sube (está en `.gitignore`). El archivo `.nojekyll` sí debe subirse.
4. **Settings › Pages › Build and deployment › Source: Deploy from a branch › Branch: `main` / `(root)` › Save**. En 1 a 2 minutos la app queda en `https://<usuario>.github.io/oleo/`.
5. Abran la URL en los dos teléfonos e instálenla:
   - Android (Chrome): botón **Instalar** en la cabecera de la app, o menú › **Instalar app**.
   - iPhone (Safari): **Compartir › Agregar a inicio**.
   El indicador de la cabecera debe decir **En la nube**.
6. Generen el QR de la portada del reporte:

   ```bash
   node herramientas/qr-portada.mjs https://<usuario>.github.io/oleo/
   ```

   Quedan `capturas/qr-portada.png` (2000 x 2000 px, corrección H) y `capturas/qr-portada.svg`. Pongan en la portada el QR al centro y el enlace cliqueable.

### 3.1 Publicar cambios después

Cada vez que cambien archivos de la app, suban también el número de versión en **dos lugares**: `VERSION` en `sw.js` y `VERSION` en `js/config.js`. Así los teléfonos ven el aviso "Hay una versión nueva de OLEO" con el botón **Actualizar**. La versión visible está al pie de `#/config`.

---

## 4. Ensayo y demo en vivo

### 4.1 Ensayos

- Ensayos de interfaz en **modo local** (sin créditos).
- 3 a 4 ensayos completos en la nube con el guion de abajo.
- Impriman la etiqueta del puesto de demo (**Descargar etiqueta del bote** en la pantalla de alta lista, PNG de 10 x 12.5 cm a 300 dpi) y péguenla en un garrafón como utilería.

### 4.2 Guion de 6 minutos (sección 15.4)

| Minuto | Acción | Qué se demuestra |
|---|---|---|
| 0:00 | El profesor escanea el QR de la portada (o se proyecta). Registran "Tacos El Güero, Cuauhtémoc" desde Inicio. Muestran Airtable con el registro nuevo. | PWA pública, registro en tiempo real |
| 1:00 | Teléfono del comerciante: Mi puesto, etiqueta del bote, nivel 85%, **Avisar que mi bote está lleno**. | Fricción mínima, medidor de datos |
| 1:45 | Teléfono del recolector (tema noche): la solicitud aparece en el mapa. **Escanear QR del bote** sobre la etiqueta del garrafón. | Escaneo en calle, ruta |
| 2:30 | **Colocar bote en la báscula**: el visor se estabiliza, lectura cruda visible, calidad aceptada, litros, monto y agua. **Registrar recolección**. | Cálculo ambiental automático |
| 3:30 | Teléfono del comerciante: **Actualizar** si hace falta, "¿Coincide?" › **Confirmar y cobrar**. Abono en segundos en ambos teléfonos. El recolector toca **Enviar comprobante por WhatsApp** y le llega al dueño el mensaje con folio, monto, clave de rastreo y enlace a su constancia. | Webhook financiero, comprobante al comerciante |
| 4:15 | Make: History de A y B. Airtable: estado Pagada, clave de rastreo y sello. | Evidencia visual |
| 5:00 | **Ver constancia** con "Sello verificado". Tablero de impacto. | Cumplimiento documental, métricas verdes |
| 5:30 | Si hay tiempo: **Confirmar con PIN** de una segunda recolección. | Comerciante sin datos |

### 4.3 Checklist antes de presentar

- [ ] Dos teléfonos cargados, hotspot propio probado.
- [ ] PWA instalada en ambos; indicador **En la nube**; versión correcta al pie de `#/config`.
- [ ] `#/config` › **Probar conexión** responde 200 (los dos escenarios encendidos).
- [ ] Sesión del recolector abierta en `#/recolector`.
- [ ] Una recolección de respaldo ya registrada (por si algo falla, se confirma con PIN).
- [ ] Pestañas de Make (History de A y B) y Airtable (tabla Recolecciones) abiertas en la laptop.
- [ ] Créditos de Make revisados (Organization › Usage).
- [ ] Etiqueta impresa pegada al garrafón.
- [ ] El puesto de demo se registra con el WhatsApp real de quien hace de comerciante (10 dígitos), para que el comprobante le llegue en vivo.

### 4.4 Checklist en teléfonos reales (sección 15.3)

- [ ] Abre por HTTPS desde el QR de portada y permite registrar un puesto.
- [ ] Instalación en Android e iOS.
- [ ] La cámara lee el QR de la etiqueta impresa con poca luz.
- [ ] Pago visible en Airtable con clave, sello y fecha; History de Make muestra A y B.
- [ ] Tiempo de la confirmación al abono menor a 10 s con hotspot.
- [ ] Recarga sin red: la app abre (app shell en caché).

---

## 5. Solución de problemas

| Síntoma en la PWA | Causa probable | Qué hacer |
|---|---|---|
| "El escenario de Make no respondió. Revisa que esté activo." | Make devolvió texto (por ejemplo `Accepted`): el escenario está apagado, no tiene Webhook response o está en "Redetermine data structure". | Encender el escenario (Scheduling ON) y guardar. No dejen el escenario apagado mientras usan la app: Make guarda esas peticiones y las ejecuta al encenderlo. |
| "Airtable rechazó la operación. Revisa el historial del escenario." (502) | Un nombre de campo no coincide, falta una fórmula o el token no tiene permisos. | En History del escenario A abran la ejecución con error: el módulo 3 muestra el mensaje exacto de Airtable. Corran `crear-base-airtable.mjs --verificar`. |
| "Sin conexión con el servidor." | Sin red, URL del webhook mal copiada o el navegador bloqueó la respuesta por CORS. | Revisen la URL en `#/config`. Confirmen que los Webhook response tengan `Access-Control-Allow-Origin: *`. |
| "Esta recolección ya fue pagada o el PIN no coincide." (409) | PIN incorrecto o la recolección ya no está en "Por confirmar". | Es el comportamiento esperado. Revisen el PIN en Airtable (Puestos › PIN). |
| "Make tardó más de 20 s en responder." | Make lento o escenario con error. | Reintentar. Revisar History. |
| "El sello no coincide con los datos" en la constancia | La fórmula `sha256` del módulo 9 no tiene exactamente `Folio|Litros|Monto|claveRastreo`. | Revisen que no haya espacios ni píldoras de otro módulo. |
| La ruta no muestra el mapa | Sin red para las teselas de OpenStreetMap. | La lista ordenada de paradas sigue funcionando. |
| El escáner no abre la cámara | Permiso denegado o navegador sin cámara. | Usar el campo **Puesto ID** + **Buscar** (respaldo manual). |
| La app muestra una versión vieja | GitHub Pages o el service worker en caché. | Subir VERSION en `sw.js` y `js/config.js`; en el teléfono tocar **Actualizar** en el aviso. |

---

## 6. Pruebas automatizadas

```bash
npm test
```

Levanta solos el servidor estático (`herramientas/servir.mjs`, puerto 4173) y el simulador HTTP de Make (`herramientas/simulador-make.mjs`, puerto 8787) y corre T0 a T10 de la sección 15.2, T11 y T12 del asistente, más la generación de capturas en `capturas/` (390 x 844, escala 2).

Para probar la PWA contra el simulador de Make a mano:

```bash
node herramientas/simulador-make.mjs --ejemplo
```

y en `#/config` usen `http://localhost:8787/hook/oleo-api` como URL del Escenario A y `http://localhost:8787/hook/spei-sim` como URL del Escenario B. La consola del simulador muestra cada petición con los créditos que habría consumido en Make. Opciones: `--latencia 250-700`, `--latencia-pago 900-1500`, `--falla-red`.

---

## 7. Notas de implementación (para el reporte)

- **Contratos:** nombres de tablas, campos, rutas, parámetros y respuestas son los de las secciones 6, 7 y 8 sin cambios. Dos ajustes compatibles, que no requieren tocar Make ni Airtable:
  - Las consultas `listRecords` del comerciante agregan `"fields"` al cuerpo JSON para que la respuesta pese menos (con 51 recolecciones, abrir Mi puesto usa unos 24 KB en lugar de unos 60 KB).
  - Al **Entrar** con Puesto ID + PIN desde otro teléfono se hace una consulta a Solicitudes (`AND(ARRAYJOIN({Puesto ID})='OLEO-0007', {Estado}='Pendiente')`) para saber si ya había un aviso pendiente.
- **Comprobante por WhatsApp:** botón en **Abono ejecutado** (recolector) y **Compartir por WhatsApp** en la constancia. Usa enlaces `wa.me` (click-to-chat): abre WhatsApp con el mensaje listo para el número que el comerciante dio al registrarse, y la persona solo toca Enviar. No requiere cuentas ni credenciales. El envío automático sin intervención (WhatsApp Business Cloud API o Twilio desde Make) queda para el piloto: requiere cuenta de Meta Business verificada y plantillas de mensaje aprobadas.
- **Asistente con IA:** `js/agente-definicion.js` es la única fuente del modelo, las instrucciones y las herramientas; `herramientas/agente-make.mjs` genera con ella el cuerpo de Make. El historial de la conversación se reenvía siempre completo y sin editar (requisito de la API para conservar el razonamiento del modelo entre turnos); la prueba T12 lo verifica. Se activa `fallbacks: "default"` para que, si un filtro de seguridad rechaza una petición, la API la reintente en otro modelo. Limitación del prototipo: quien tenga la URL del webhook puede conversar con el asistente a costa del equipo (por eso el límite de gasto); en producción, sesiones autenticadas y límite de mensajes por puesto.
- **Escenario B:** se recomienda agregar `Access-Control-Allow-Origin: *` a su Webhook response (solo lo usa el botón de prueba de `#/config`).
- **Errores de Airtable:** con el manejador de error del módulo 3, cualquier rechazo de Airtable llega a la PWA como 502 `AIRTABLE_ERROR`; el detalle queda en History de Make. El simulador reproduce lo mismo.
- **Primera carga:** todo el app shell que precachea el service worker pesa unos 92 KB comprimidos (meta: 120 KB). jsQR y Leaflet solo se descargan en las vistas del recolector.
- **Firmware:** `firmware/oleo_bascula_esp32/oleo_bascula_esp32.ino` usa la API 2.x de NimBLE-Arduino. Compílenlo en Arduino IDE con la tarjeta "ESP32 Dev Module" antes de presentarlo como entregable.
