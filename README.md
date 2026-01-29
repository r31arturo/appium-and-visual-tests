# Appium + WebdriverIO minimal mobile and visual tests

Proyecto base súper compacto para ejecutar pruebas funcionales y de regresión visual en Android e iOS usando Appium 3 + WebdriverIO 9 y el Visual Service de WDIO (`@wdio/visual-service`). Listo para funcionar tanto en BrowserStack como en un servidor Appium local.

## Requisitos
- Node.js 18+
- Cuenta de BrowserStack (solo si corres en BrowserStack) con `BROWSERSTACK_USER`/`BROWSERSTACK_KEY` o `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY`. Configúralas por variables de entorno o GitHub Secrets, nunca en el repositorio.
- App bajo prueba: `APP=bs://...` para BrowserStack (si no defines `APP`, se usa el demo por defecto del repo) o ruta local al binario cuando se use Appium local. En local también puedes dejar el binario en `apps/`.
- (Local Android) Android SDK + emulador/dispositivo y `adb` en PATH.
- (Local iOS) macOS + Xcode + runtimes de iOS instalados (usa `xcode-select` apuntando a Xcode, no CommandLineTools).

## Instalación
```bash
npm install
```

## Configuración
Las opciones principales viven en `wdio.conf.js` y se pueden sobreescribir con variables de entorno:
- `BROWSERSTACK_USER` / `BROWSERSTACK_KEY`: habilitan el servicio de BrowserStack.
- `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY`: alternativa de nombres para las credenciales.
- `APP`: identificador de la app en BrowserStack (`bs://...`) o ruta al binario local (`.apk` Android, `.app` iOS Simulator, `.ipa` iOS real).
- `PLATFORM_NAME`: `Android` o `iOS` (por defecto `Android`).
- `DEVICE_NAME` / `PLATFORM_VERSION`: para usar un dispositivo/OS específico.
- `BROWSERSTACK_PROJECT_NAME` / `BROWSERSTACK_BUILD_NAME`: nombre del proyecto/build en BrowserStack (por defecto `appium-and-visual-tests`).
- `BROWSERSTACK_SESSION_NAME`: nombre de la sesión en BrowserStack (por defecto `run-<id>-<timestamp>`).
- `TEST_USERNAME` / `TEST_PASSWORD`: credenciales dummy para el flujo de login (por defecto `demo@example.com` / `password`).
- `VISUAL_COMPARE`: `true`/`false` para habilitar el servicio visual (`npm run visual` ya lo activa).
- `REPORT_SCREENSHOT_DOWNSCALE`: grado de downgrade para las imágenes embebidas en el reporte Mochawesome (acepta `0-1` o `0-100`; por defecto `0.3`, `1` desactiva el downgrade). No afecta las capturas de comparación visual.
- `REPORT_SCREENSHOT_DISPLAY_WIDTH`: ancho fijo (px) para mostrar capturas en el HTML de Mochawesome y estandarizar tamanos entre Android/iOS.
- `WDIO_LOG_LEVEL`: nivel global de logs de WDIO (por defecto `info`).
- `WDIO_WEBDRIVER_LOG_LEVEL`: nivel de logs del logger `webdriver` (por defecto `info`; usa `warn` si quieres menos ruido).
- `APPIUM_LOG_LEVEL` / `APPIUM_LOG_PATH`: nivel y ruta del log de Appium cuando corres local.
- `APPIUM_HOST` / `APPIUM_PORT` / `APPIUM_PATH`: host/puerto/path del servidor Appium local (por defecto `127.0.0.1:4723/wd/hub`).
- `IOS_SIMULATOR_STARTUP_TIMEOUT`, `IOS_WDA_LAUNCH_TIMEOUT`, `IOS_WDA_CONNECTION_TIMEOUT`, `IOS_SHOW_XCODE_LOG`: timeouts/logs para iOS local y CI.
- `WDIO_CONNECTION_RETRY_TIMEOUT`: timeout global de conexión (útil en iOS CI).

### Ajuste de downscale del reporte
El ajuste se hace con la variable de entorno `REPORT_SCREENSHOT_DOWNSCALE` (no editando código). Está pensada solo para las imágenes que quedan en `report/` para Mochawesome; no toca las capturas de comparación visual.
Si `sharp` no está disponible, el downgrade se omite automáticamente.

- Más pesado (mejor calidad, mayor tamaño): valores altos, cerca de `1` o `100`.
- Menos pesado (menor calidad, menor tamaño): valores bajos, cerca de `0.2` o `20`.
- Valores típicos:
  - `1` / `100`: sin downgrade (más pesado).
  - `0.6` / `60`: balanceado.
  - `0.3` / `30`: liviano (default).
  - `0.2` / `20`: muy liviano (límite mínimo).

Ejemplo:
```bash
REPORT_SCREENSHOT_DOWNSCALE=0.5 npm test
```

Las capturas base se guardan en `report/visual-baseline/` y las diferencias en `report/visual-output/`. Si la imagen base no existe se crea automáticamente en la primera ejecución.

## Ejecutar pruebas
```bash
npm test
```

```bash
npm run visual
```

### Ejecutar en BrowserStack
```bash
export BROWSERSTACK_USER="<tu-usuario>"
export BROWSERSTACK_KEY="<tu-access-key>"
export APP="bs://<id-de-tu-app>"
# Opcional: export PLATFORM_NAME="iOS" DEVICE_NAME="iPhone 15" PLATFORM_VERSION="17"
npm test
```
### Workflow manual (GitHub Actions)
Ejecuta el workflow **Manual CI (BrowserStack Only)** y define el input `app` (BrowserStack App ID, `bs://...`), elige `platform_name` (Android/iOS) y un `spec` opcional. Requiere secrets `BROWSERSTACK_USER`/`BROWSERSTACK_KEY`. Para cambiar el nombre del build/suite en CI, define `BROWSERSTACK_PROJECT_NAME` y `BROWSERSTACK_BUILD_NAME` como variables del repo (si no, usan `appium-and-visual-tests`).

> Nota: si alguna credencial estuvo expuesta públicamente, rótala de inmediato en BrowserStack y actualiza los secrets.

### CI en simuladores (GitHub Actions)
- **CI (Emulator)** corre en cada PR contra `main` y ejecuta Android (Ubuntu) + iOS (macOS).
- **Manual CI (Emulator)** permite disparar Android/iOS manualmente, pasar un `spec` opcional y elegir `platform` (`android`, `ios` o `both`).
- Android descarga el demo app de WebdriverIO (tag `v1.0.8`) antes de ejecutar.
- El job de iOS descarga el binario de simulador desde:
  https://github.com/webdriverio/native-demo-app/releases/download/v2.0.0/ios.simulator.wdio.native.app.v2.0.0.zip
- Para fijar la versión de iOS en CI, define `IOS_RUNTIME_MAJOR` (ej: `18`) o `PLATFORM_VERSION` (ej: `18.6`).
- Si el simulador tarda en arrancar, ajusta `IOS_SIMULATOR_STARTUP_TIMEOUT` (milisegundos).

### Ejecutar local (Appium)
El servicio de Appium se levanta automáticamente por WDIO (no necesitas iniciarlo manualmente).

#### Comandos rápidos
```bash
npm run test:android
npm run test:ios
npm run test:ci:login
```
> Si `APP` no está definido, se busca automáticamente en `apps/` según `PLATFORM_NAME`.

#### Android (emulador o dispositivo)
```bash
npx appium driver install uiautomator2
export PLATFORM_NAME="Android"
export APP="/ruta/a/tu/app.apk"
# Opcional: export DEVICE_NAME="Android Emulator" PLATFORM_VERSION="14.0" UDID="emulator-5554"
npm test
```

#### iOS (Simulator)
```bash
npx appium driver install xcuitest
export PLATFORM_NAME="iOS"
export APP="/ruta/a/tu/app.app" # .app para Simulator, .ipa para dispositivo real
# Opcional: export DEVICE_NAME="iPhone 15" PLATFORM_VERSION="18.2" UDID="<udid>"
npm test
```

Puedes obtener binarios de ejemplo listos para Android e iOS desde el repositorio de WebdriverIO:
https://github.com/webdriverio/native-demo-app/releases

Usa `APP` para apuntar al `.apk`, `.app` (iOS Simulator) o `.ipa` descargado (o súbelo a BrowserStack y usa el `bs://...` resultante). Estos binarios funcionan bien para validar el flujo completo de WebdriverIO + Appium.
Para iOS Simulator, descarga el `.zip`, descomprímelo y apunta `APP` al `.app` resultante.
Si quieres usar auto-detección, deja el binario en `apps/` (o subcarpetas) y ejecuta `npm run test:android` o `npm run test:ios`.
En iOS local, si no defines `DEVICE_NAME`/`PLATFORM_VERSION`/`UDID`, se usa el simulador iOS **ya booted** (preferencia iPhone). Si no hay un simulador abierto, la ejecución falla.

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
- **Visual baselines**: las capturas base viven en `report/visual-baseline/` y las diferencias se guardan en `report/visual-output/`.

## Cómo agregar tests al repo
1. **Crear/actualizar la pantalla** en `tests/screens/` con getters y métodos cortos. Usa los helpers de `tests/utils/selectors.js` para mantener el formato de los locators de iOS/Android.
2. **Crear un flow** en `tests/flows/` que combine los pasos necesarios (abrir la pantalla, completar formularios, validar waits, etc.). Mantén la lógica reutilizable aquí.
3. **Escribir el spec** en `tests/specs/` (formato `*.spec.js`) importando el flow. Usa `describe/it` de Mocha y las expectativas de `expect` ya incluidas por WebdriverIO.
4. **Agregar visuales (opcional)**: usa `browser.saveScreen()` y `browser.checkScreen()` dentro del flow o del spec. Ejecuta con `npm run visual` (o `VISUAL_COMPARE=true`) para crear/comparar baselines en `report/visual-baseline/`.
5. **Ejecutar solo tu spec**: `npm run test:ci -- --spec ./tests/specs/tu-test.spec.js` o en CI usando el input `spec`.

## Visual testing pixel-perfect
Se usa `@wdio/visual-service` para validar la UI. El flujo de login incluye ejemplos de captura y comparación (`captureLanding()` en `tests/flows/login.flow.js`).
- `browser.saveScreen()` genera la baseline si no existe.
- `browser.checkScreen()` o `browser.checkElement()` devuelven `0` cuando no hay diferencias visuales.
> Nota: el servicio visual solo se activa si `VISUAL_COMPARE=true` (o con `npm run visual`).

## Reporte
El reporter `spec` de WebdriverIO mantiene la salida limpia y legible. Además se genera:
- HTML en `report/mochawesome-functional.html` o `report/mochawesome-visual.html`.
- Screenshots embebidas en `report/mochawesome-screenshots/`.
- JUnit XML en `report/junit/` cuando estás en CI.
- Page source en `report/page-source/` cuando un test falla.
Puedes modificar los reporters en `wdio.conf.js` sin agregar frameworks extra como Cucumber.
