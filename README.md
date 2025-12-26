# Appium + WebdriverIO minimal mobile and visual tests

Proyecto base súper compacto para ejecutar pruebas funcionales y de regresión visual en Android e iOS usando Appium 2 + WebdriverIO 8 y la Image Comparison Service. Listo para funcionar tanto en BrowserStack como en un servidor Appium local.

## Requisitos
- Node.js 18+
- Cuenta de BrowserStack (variables `BROWSERSTACK_USER` y `BROWSERSTACK_KEY`) si vas a ejecutar en BrowserStack.
- App bajo prueba publicado en BrowserStack (`APP` con valor `bs://...`) o ruta local al binario cuando se use Appium local.

## Instalación
```bash
npm install
```

## Configuración
Las opciones principales viven en `wdio.base.conf.js` y se consumen desde:
- `wdio.local.conf.js` (Appium local / emulador)
- `wdio.browserstack.conf.js` (BrowserStack)

Variables de entorno:
- `BROWSERSTACK_USER` / `BROWSERSTACK_KEY`: credenciales de BrowserStack.
- `PLATFORM_NAME`: `Android` o `iOS` (por defecto `Android`).
- `DEVICE_NAME` / `PLATFORM_VERSION`: para usar un dispositivo/OS específico.
- `BUILD_NAME`: nombre del build en los reportes.
- `APP`: ruta local al binario cuando usas Appium local, o identificador de BrowserStack (`bs://...`) cuando usas BrowserStack.
- `RUN_TARGET=browserstack` o `USE_BROWSERSTACK=true`: habilita BrowserStack en `wdio.browserstack.conf.js`.

Las capturas base se guardan en `visual-baseline/` y las diferencias en `visual-output/`. Si la imagen base no existe se crea automáticamente en la primera ejecución.

## Ejecutar pruebas
```bash
npm test
```
Por defecto corre contra Appium local (equivalente a `npm run test:local`).

### Ejecutar en BrowserStack
```bash
export RUN_TARGET=browserstack
export BROWSERSTACK_USER="<tu-usuario>"
export BROWSERSTACK_KEY="<tu-access-key>"
export APP="bs://<id-de-tu-app>"
# Opcional: export PLATFORM_NAME="iOS" DEVICE_NAME="iPhone 15" PLATFORM_VERSION="17"
npm run test:bs
```

### Ejecutar contra Appium local
Asegúrate de tener el servidor Appium 2 corriendo en `127.0.0.1:4723` y expón el binario de la app:
```bash
export APP="/ruta/a/tu/app.apk" # o .ipa
npm run test:local
```

Puedes obtener binarios de ejemplo listos para Android e iOS desde el repositorio de WebdriverIO:
https://github.com/webdriverio/native-demo-app/releases

Usa `APP` para apuntar al `.apk` o `.ipa` descargado (o súbelo a BrowserStack y usa el `bs://...` resultante). Estos binarios funcionan bien para validar el flujo completo de WebdriverIO + Appium.

## Estructura POM + Flows
La suite está organizada en **Page Objects + Flows**, sin Cucumber ni Screenplay:

```
tests/
├── flows/          # Flujos de negocio muy finos que combinan varias pantallas
│   └── login.flow.js
├── screens/        # Page Objects: una clase por pantalla con getters y métodos breves
│   ├── home.screen.js
│   ├── landing.screen.js
│   └── login.screen.js
├── specs/          # Casos de prueba Mocha que usan los flows
│   └── login.spec.js
└── utils/
    └── selectors.js # Helpers para estandarizar los locators (iOS predicate / Android UiSelector)
```

- **Page Objects (`tests/screens/`)**: encapsulan los locators (getters) y acciones cortas como `login(user, pass)` o `waitForDisplayed()`.
- **Flows (`tests/flows/`)**: combinan pasos de varias pantallas en funciones reutilizables, por ejemplo `performBasicLogin()`.
- **Specs (`tests/specs/`)**: describen los escenarios usando los flows y las aserciones de `expect-webdriverio`.
- **Selectors utils (`tests/utils/selectors.js`)**: documentan el formato de plantillas iOS (`-ios predicate string:name == "<...>"`) y Android (`android=new UiSelector().resourceId("<...>")`) para mantener consistencia en los locators.
- **Visual baselines**: las capturas base viven en `visual-baseline/` y las diferencias se guardan en `visual-output/`.

## Cómo agregar un test nuevo
1. **Crear/actualizar la pantalla** en `tests/screens/` con getters y métodos cortos. Usa los helpers de `tests/utils/selectors.js` para mantener el formato de los locators de iOS/Android.
2. **Crear un flow** en `tests/flows/` que combine los pasos necesarios (abrir la pantalla, completar formularios, validar waits, etc.).
3. **Escribir el spec** en `tests/specs/` (formato `*.spec.js`) importando el flow. Usa `describe/it` de Mocha y las expectativas de `expect` ya incluidas por WebdriverIO.
4. (Opcional) **Agregar checkpoints visuales** con `browser.saveScreen()` y `browser.checkScreen()` dentro del flow o del spec para generar/comparar baselines.

## Visual testing pixel-perfect
Se usa `wdio-image-comparison-service` para validar la UI. El flujo de login incluye ejemplos de captura y comparación (`captureLanding()` en `tests/flows/login.flow.js`).
- `browser.saveScreen()` genera la baseline si no existe.
- `browser.checkScreen()` o `browser.checkElement()` devuelven `0` cuando no hay diferencias visuales.

## Reporte
El reporter `spec` de WebdriverIO mantiene la salida limpia y legible. Puedes modificar los reporters en `wdio.base.conf.js` sin agregar frameworks extra como Cucumber.

## Agregar más pruebas
Usa el patrón anterior para crear archivos `*.spec.js` dentro de `tests/specs/`. No se necesitan hooks adicionales; las expectativas vienen de `expect-webdriverio`.
