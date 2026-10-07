// Pruebas E2E de OLEO (sección 15.2). Uso: npx playwright test
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: /e2e\.spec\.mjs$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,               // el simulador HTTP es compartido
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }
  },
  webServer: [
    { command: 'node herramientas/servir.mjs --puerto 4173', url: 'http://localhost:4173/', reuseExistingServer: true },
    { command: 'node herramientas/simulador-make.mjs --puerto 8787 --latencia 40-120 --latencia-pago 300-600 --silencioso', url: 'http://localhost:8787/__estado', reuseExistingServer: true }
  ]
});
