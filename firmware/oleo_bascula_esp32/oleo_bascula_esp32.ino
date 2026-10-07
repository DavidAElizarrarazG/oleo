/*
  OLEO: báscula IoT para el acopio de aceite vegetal usado (POC, Sprint 2)
  Entregable documental: el POC usa la báscula simulada de la PWA. Este firmware implementa
  el mismo contrato BLE (sección 12.2) para pasar al hardware real.

  Tarjeta:   ESP32 DevKit v1 (Arduino IDE, núcleo esp32 de Espressif 2.x o 3.x)
  Librerías: HX711 de Bogdan Necula (bogde), 0.7.x
             NimBLE-Arduino de h2zero, 2.x (para 1.4.x ver la nota en las clases de callbacks)

  Conexiones
  ----------
     Celda de carga 50 kg            HX711                 ESP32 DevKit v1
     (o 4 medias celdas con          +---------+
      combinador)                    | E+  VCC |---------- 3V3
       rojo   ---------------------- | E+      |
       negro  ---------------------- | E-  GND |---------- GND
       verde  ---------------------- | A+   DT |---------- GPIO16
       blanco ---------------------- | A-  SCK |---------- GPIO4
                                     +---------+

     Sensor de turbidez DFRobot SEN0189 (salida analógica de 0 a 4.5 V)
       VCC  ------------------------------------------- VIN (5 V)
       GND  ------------------------------------------- GND
       A0   ---[ R1 10 kΩ ]---+------------------------ GPIO34 (solo entrada, ADC1)
                              |
                          [ R2 20 kΩ ]
                              |
                             GND
     Divisor: Vadc = Vsensor x 20 / 30. Con 4.5 V del sensor llegan 3.0 V al ADC (máximo 3.3 V).

  Contrato BLE (igual que js/scale.js)
  ------------------------------------
     Nombre:          OLEO-BASCULA-01 (prefijo OLEO-BASCULA)
     Servicio:        6f6c656f-0001-4b1a-9c2d-202610080001
     Lectura notify:  6f6c656f-0002-4b1a-9c2d-202610080001  JSON UTF-8 <= 100 bytes a 5 Hz:
                      {"raw":402960,"kg":14.86,"stable":true,"ntu":38.2,"bat":92}
     Comandos write:  6f6c656f-0003-4b1a-9c2d-202610080001  "TARE" o "CAL:<kg>"

  Calibración
  -----------
     1. Plataforma vacía: enviar TARE (guarda el offset en NVS).
     2. Colocar una masa conocida, por ejemplo un garrafón con 10 L de agua (unos 10 kg).
     3. Enviar CAL:10 (calcula y guarda el factor en NVS).
     También se pueden mandar los comandos por el monitor serie a 115200 baudios.

  Turbidez: aproximación indicativa con la curva del fabricante
     NTU = -1120.4 V^2 + 5742.3 V - 4352.9, para V entre 2.5 y 4.2 V (fuera de rango se limita).
     No sustituye la medición de compuestos polares totales en laboratorio.
*/

#include <Arduino.h>
#include <HX711.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <math.h>
#include <string>

// ---------- Configuración ----------
static const char *NOMBRE_BLE = "OLEO-BASCULA-01";
static const char *UUID_SERVICIO = "6f6c656f-0001-4b1a-9c2d-202610080001";
static const char *UUID_LECTURA = "6f6c656f-0002-4b1a-9c2d-202610080001";
static const char *UUID_COMANDOS = "6f6c656f-0003-4b1a-9c2d-202610080001";

static const int PIN_HX711_DT = 16;
static const int PIN_HX711_SCK = 4;
static const int PIN_TURBIDEZ = 34;
static const int PIN_BATERIA = -1;              // GPIO35 con divisor si hay batería; -1 = sin medición

static const float FACTOR_DIVISOR = 30.0f / 20.0f;   // (R1 + R2) / R2
static const long OFFSET_INICIAL = 84213;            // cuentas con la plataforma vacía (igual que el simulador)
static const float FACTOR_INICIAL = 21450.0f;        // cuentas por kg
static const float ALFA_EMA = 0.35f;                 // media móvil exponencial
static const int VENTANA_ESTABLE = 10;               // lecturas (1 s a 10 Hz)
static const float UMBRAL_ESTABLE_KG = 0.02f;
static const uint32_t PERIODO_NOTIFY_MS = 200;       // 5 Hz

// ---------- Estado ----------
HX711 hx711;
Preferences preferencias;
long offsetCuentas = OFFSET_INICIAL;
float factorCuentas = FACTOR_INICIAL;

long ultimos3[3] = {0, 0, 0};
int cuantos3 = 0;
int indice3 = 0;
float filtrado = NAN;
float historial[VENTANA_ESTABLE];
int cuantosHist = 0;
int indiceHist = 0;

long rawActual = 0;
float kgActual = 0.0f;
bool estable = false;
float ntuActual = 0.0f;
int bateria = 100;

NimBLECharacteristic *caracteristicaLectura = nullptr;
volatile bool conectado = false;
volatile bool pedirTara = false;
volatile float pedirCalibracion = 0.0f;
uint32_t ultimoNotify = 0;

// ---------- Utilidades ----------
long mediana3(long a, long b, long c) {
  return max(min(a, b), min(max(a, b), c));
}

void reiniciarEstabilidad() {
  cuantosHist = 0;
  indiceHist = 0;
  estable = false;
}

void procesarComando(const std::string &cmd) {
  if (cmd == "TARE") {
    pedirTara = true;
  } else if (cmd.rfind("CAL:", 0) == 0) {
    float kg = atof(cmd.c_str() + 4);
    if (kg > 0.1f) pedirCalibracion = kg;
  }
}

// ---------- BLE (API de NimBLE-Arduino 2.x) ----------
// Para NimBLE-Arduino 1.4.x: onConnect(NimBLEServer*), onDisconnect(NimBLEServer*) y
// onWrite(NimBLECharacteristic*), sin el parámetro NimBLEConnInfo; y setScanResponse(true)
// en lugar de enableScanResponse(true).
class CallbacksServidor : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *servidor, NimBLEConnInfo &info) override {
    conectado = true;
    Serial.println("BLE: conectado");
  }
  void onDisconnect(NimBLEServer *servidor, NimBLEConnInfo &info, int razon) override {
    conectado = false;
    Serial.printf("BLE: desconectado (%d), anunciando de nuevo\n", razon);
    NimBLEDevice::startAdvertising();
  }
};

class CallbacksComandos : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *caracteristica, NimBLEConnInfo &info) override {
    NimBLEAttValue valor = caracteristica->getValue();
    std::string cmd(reinterpret_cast<const char *>(valor.data()), valor.length());
    Serial.printf("BLE: comando %s\n", cmd.c_str());
    procesarComando(cmd);
  }
};

void iniciarBLE() {
  NimBLEDevice::init(NOMBRE_BLE);
  NimBLEDevice::setMTU(185);  // el payload JSON (unos 60 bytes) no cabe en el MTU por defecto de 23
  NimBLEServer *servidor = NimBLEDevice::createServer();
  servidor->setCallbacks(new CallbacksServidor());

  NimBLEService *servicio = servidor->createService(UUID_SERVICIO);
  caracteristicaLectura = servicio->createCharacteristic(UUID_LECTURA, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic *comandos = servicio->createCharacteristic(UUID_COMANDOS, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  comandos->setCallbacks(new CallbacksComandos());
  servicio->start();

  NimBLEAdvertising *anuncio = NimBLEDevice::getAdvertising();
  anuncio->setName(NOMBRE_BLE);
  anuncio->addServiceUUID(UUID_SERVICIO);
  anuncio->enableScanResponse(true);  // el nombre y el UUID de 128 bits no caben en un solo paquete
  anuncio->start();
  Serial.printf("BLE: anunciando como %s\n", NOMBRE_BLE);
}

// ---------- Sensores ----------
void leerBascula() {
  if (!hx711.is_ready()) return;  // el HX711 entrega 10 muestras/s con RATE a GND
  long crudo = hx711.read();

  ultimos3[indice3] = crudo;
  indice3 = (indice3 + 1) % 3;
  if (cuantos3 < 3) cuantos3++;
  long med = cuantos3 < 3 ? crudo : mediana3(ultimos3[0], ultimos3[1], ultimos3[2]);
  filtrado = isnan(filtrado) ? (float)med : filtrado + ALFA_EMA * ((float)med - filtrado);
  rawActual = lroundf(filtrado);

  if (pedirTara) {
    pedirTara = false;
    offsetCuentas = rawActual;
    preferencias.putLong("offset", offsetCuentas);
    reiniciarEstabilidad();
    Serial.printf("TARE: offset = %ld\n", offsetCuentas);
  }
  if (pedirCalibracion > 0.0f) {
    float kg = pedirCalibracion;
    pedirCalibracion = 0.0f;
    long neto = rawActual - offsetCuentas;
    if (labs(neto) > 1000) {
      factorCuentas = (float)neto / kg;
      preferencias.putFloat("factor", factorCuentas);
      Serial.printf("CAL: factor = %.2f cuentas/kg con %.2f kg\n", factorCuentas, kg);
    } else {
      Serial.println("CAL: la lectura es muy pequeña; coloca la masa conocida antes de calibrar");
    }
    reiniciarEstabilidad();
  }

  kgActual = (float)(rawActual - offsetCuentas) / factorCuentas;
  historial[indiceHist] = kgActual;
  indiceHist = (indiceHist + 1) % VENTANA_ESTABLE;
  if (cuantosHist < VENTANA_ESTABLE) cuantosHist++;
  if (cuantosHist == VENTANA_ESTABLE) {
    float mn = historial[0], mx = historial[0];
    for (int i = 1; i < VENTANA_ESTABLE; i++) {
      mn = min(mn, historial[i]);
      mx = max(mx, historial[i]);
    }
    estable = (mx - mn) < UMBRAL_ESTABLE_KG;
  } else {
    estable = false;
  }
}

void leerTurbidez() {
  uint32_t suma = 0;
  for (int i = 0; i < 8; i++) suma += analogReadMilliVolts(PIN_TURBIDEZ);
  float v = (suma / 8.0f) / 1000.0f * FACTOR_DIVISOR;  // se deshace el divisor
  v = constrain(v, 2.5f, 4.2f);
  float ntu = -1120.4f * v * v + 5742.3f * v - 4352.9f;
  ntuActual = max(0.0f, ntu);
}

void leerBateria() {
  if (PIN_BATERIA < 0) { bateria = 100; return; }
  float v = analogReadMilliVolts(PIN_BATERIA) / 1000.0f * 2.0f;  // divisor 1:1 para una celda de 4.2 V
  bateria = constrain((int)((v - 3.3f) / (4.2f - 3.3f) * 100.0f), 0, 100);
}

void notificar() {
  char json[100];
  int n = snprintf(json, sizeof(json), "{\"raw\":%ld,\"kg\":%.2f,\"stable\":%s,\"ntu\":%.1f,\"bat\":%d}",
                   rawActual, kgActual, estable ? "true" : "false", ntuActual, bateria);
  if (n <= 0 || n >= (int)sizeof(json)) return;
  if (conectado && caracteristicaLectura) {
    caracteristicaLectura->setValue(reinterpret_cast<const uint8_t *>(json), n);
    caracteristicaLectura->notify();
  }
  Serial.println(json);
}

// ---------- Arduino ----------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("OLEO báscula: iniciando");

  preferencias.begin("oleo", false);
  offsetCuentas = preferencias.getLong("offset", OFFSET_INICIAL);
  factorCuentas = preferencias.getFloat("factor", FACTOR_INICIAL);
  Serial.printf("Calibración: offset = %ld, factor = %.2f cuentas/kg\n", offsetCuentas, factorCuentas);

  hx711.begin(PIN_HX711_DT, PIN_HX711_SCK);  // canal A, ganancia 128
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_TURBIDEZ, ADC_11db);
  if (PIN_BATERIA >= 0) analogSetPinAttenuation(PIN_BATERIA, ADC_11db);

  iniciarBLE();
}

void loop() {
  leerBascula();

  // Comandos también por el monitor serie: TARE o CAL:10
  if (Serial.available()) {
    String linea = Serial.readStringUntil('\n');
    linea.trim();
    procesarComando(std::string(linea.c_str()));
  }

  uint32_t ahora = millis();
  if (ahora - ultimoNotify >= PERIODO_NOTIFY_MS) {
    ultimoNotify = ahora;
    leerTurbidez();
    leerBateria();
    notificar();
  }
  delay(2);
}
