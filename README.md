# OLEO

Plataforma de captación, validación y monetización inmediata de aceite vegetal usado (AVU) para el comercio de alimentos de la Ciudad de México. Prueba de concepto del Sprint 2 de *Tendencias en la Transformación y Disrupción Digital* (Grupo 900 CIB, Universidad La Salle México).

**Equipo:** David Alejandro Elizarraraz García, Diego Sastre Villaseñor, Ulises Domínguez Hernández y Alejandra Roa Alonso.

**App publicada:** https://davidaelizarrarazg.github.io/oleo/ (QR de portada en `capturas/qr-portada.png`).

> Todo lo financiero es simulado: no hay dinero real, cuentas bancarias ni credenciales. La báscula IoT también se simula dentro de la PWA.

## Qué hace

Registro del puesto (desde el QR de la portada) → aviso de "bote lleno" → ruta nocturna del recolector → escaneo del QR del bote → pesaje con báscula HX711 simulada → control de calidad por turbidez → doble confirmación del comerciante (app o PIN en sitio) → webhook de Make hacia una API SPEI/CoDi simulada → abono inmediato → comprobante al dueño por WhatsApp (enlace wa.me con el mensaje listo) → constancia con sello SHA-256 verificable → métricas verdes (1 L de aceite = 1,000 L de agua protegidos).

Además, el comerciante tiene un **asistente con IA** (Claude vía Make) que consulta su saldo, avisa que su bote está lleno y le muestra la recolección por cobrar; el pago siempre lo confirma el comerciante con un botón.

## Arquitectura

| Capa | Componente |
|---|---|
| Aplicación | PWA en HTML, CSS y JavaScript con ES modules, sin framework ni build. GitHub Pages. |
| Integración | Make: Escenario A "OLEO API" (gateway y orquestación del pago) y Escenario B "API financiera simulada". |
| Datos | Airtable: base OLEO con tablas Puestos, Solicitudes y Recolecciones. |
| Tecnología | Service worker, ESP32 + HX711 + sensor de turbidez SEN0189 (firmware de referencia). |

La PWA habla siempre el mismo contrato (`POST` form-urlencoded al webhook, sin preflight de CORS). Con transporte **nube** llama a Make; con transporte **local** usa `js/sim/make-airtable-sim.js`, un simulador del contrato completo que también corre en Node para las pruebas.

## Empezar

```bash
npm install
```

```bash
node herramientas/servir.mjs
```

Abran `http://localhost:4173/`. Sin URL de webhook la app trabaja en modo local. Para conectar Airtable, Make y GitHub Pages sigan **[docs/SETUP.md](docs/SETUP.md)**.

## Estructura

```
index.html, manifest.webmanifest, sw.js, .nojekyll
css/app.css                    sistema visual (día y noche)
js/app.js                      router por hash, layout, instalación, service worker
js/config.js                   configuración (aquí va la URL del webhook)
js/api.js                      adaptador de dominio, transportes nube/local, cola offline, medidor de bytes
js/sim/make-airtable-sim.js    simulador del contrato Make + Airtable (navegador y Node)
js/sim/datos-ejemplo.js        datos de ejemplo inventados
js/metrics.js                  métricas verdes y monetización
js/scale.js                    báscula simulada (HX711) y cliente Web Bluetooth
js/qr.js                       QR del puesto, escáner y etiqueta PNG
js/whatsapp.js                 comprobante de pago por WhatsApp (wa.me)
js/agente.js                   asistente: ciclo de herramientas y conversación
js/agente-definicion.js        modelo, instrucciones y herramientas del asistente (fuente del cuerpo de Make)
js/sim/agente-simulado.js      modelo simulado del asistente (modo local y pruebas)
js/route.js                    alcaldías, clústeres y vecino más cercano
js/util.js                     DOM, formato es-MX, avisos, sha256, sondeo
js/views/                      inicio, comerciante, recolector, constancia, impacto, ajustes
vendor/                        qrcode-generator, jsQR y Leaflet (copias locales)
icons/                         íconos de la PWA
firmware/oleo_bascula_esp32/   firmware de referencia para ESP32
herramientas/                  simulador de Make, scripts de Airtable, QR de portada, servidor local
tests/e2e.spec.mjs             pruebas E2E (Playwright)
docs/SETUP.md                  guía paso a paso para el equipo
capturas/                      pantallas para el reporte
```

## Herramientas (Node solo para desarrollo)

| Comando | Para qué |
|---|---|
| `node herramientas/servir.mjs` | Servidor estático local en el puerto 4173 |
| `node herramientas/simulador-make.mjs --ejemplo` | Make + Airtable simulados por HTTP en el puerto 8787 |
| `node herramientas/crear-base-airtable.mjs` | Crea tablas y campos en Airtable (`--verificar` revisa el esquema) |
| `node herramientas/sembrar-airtable.mjs` | Carga datos de ejemplo en Airtable |
| `node herramientas/qr-portada.mjs <URL>` | QR de la portada (PNG 2000 px y SVG) |
| `node herramientas/agente-make.mjs` | Cuerpo de la petición a Claude para el módulo HTTP de Make |
| `node herramientas/generar-iconos.mjs` | Regenera los íconos PNG desde `icons/icon.svg` |
| `node herramientas/copiar-vendor.mjs` | Copia y minifica las librerías a `vendor/` |
| `npm test` | Pruebas E2E T0 a T12 y capturas |

## Créditos de terceros

| Librería | Versión | Licencia |
|---|---|---|
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), Kazuhiko Arase | 1.4.4 | MIT |
| [jsQR](https://github.com/cozmo/jsQR), Cosmo Wolfe | 1.4.0 | Apache-2.0 |
| [Leaflet](https://leafletjs.com), Volodymyr Agafonkin y colaboradores | 1.9.4 | BSD-2-Clause |
| Teselas y datos del mapa: [OpenStreetMap](https://www.openstreetmap.org/copyright) | | ODbL |

"QR Code" es marca registrada de DENSO WAVE INCORPORATED. Herramientas de desarrollo: Playwright (Apache-2.0), Terser (BSD-2-Clause) y el SDK de Anthropic para TypeScript (MIT), este último solo en el simulador de Node.

## Licencia

MIT. Ver [LICENSE](LICENSE).
