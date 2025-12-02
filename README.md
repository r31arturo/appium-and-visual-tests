# Appium + WebdriverIO minimal mobile and visual tests

Proyecto base súper compacto para ejecutar pruebas funcionales y de regresión visual en Android e iOS usando Appium 2 + WebdriverIO 8 y la Image Comparison Service. Listo para funcionar tanto en BrowserStack como en un servidor Appium local.

## Requisitos
- Node.js 18+
- Cuenta de BrowserStack (variables `BROWSERSTACK_USER` y `BROWSERSTACK_KEY`). El proyecto ya viene con las credenciales de
  **arevaloasuaje2 / J7UFcAyfTG1wgVv8qDo2** configuradas como valores por defecto para ejecutar en App Automate.
- App bajo prueba publicado en BrowserStack (`APP` con valor `bs://...`) o ruta local al binario cuando se use Appium local.

## Instalación
```bash
npm install
```

## Configuración
Las opciones principales viven en `wdio.conf.js` y se pueden sobreescribir con variables de entorno:
- `BROWSERSTACK_USER` / `BROWSERSTACK_KEY`: habilitan el servicio de BrowserStack.
- `APP`: identificador de la app en BrowserStack (`bs://...`) o ruta al binario local.
- `PLATFORM_NAME`: `Android` o `iOS` (por defecto `Android`).
- `DEVICE_NAME` / `PLATFORM_VERSION`: para usar un dispositivo/OS específico.
- `BUILD_NAME`: nombre del build en los reportes.

Las capturas base se guardan en `visual-baseline/` y las diferencias en `visual-output/`. Si la imagen base no existe se crea automáticamente en la primera ejecución.

## Ejecutar pruebas
```bash
npm test
```

### Ejecutar en BrowserStack
```bash
export BROWSERSTACK_USER="<tu-usuario>"
export BROWSERSTACK_KEY="<tu-access-key>"
export APP="bs://<id-de-tu-app>"
# Opcional: export PLATFORM_NAME="iOS" DEVICE_NAME="iPhone 15" PLATFORM_VERSION="17"
npm test
```

Si no exportas las variables de BrowserStack, el runner usará automáticamente `arevaloasuaje2` como usuario y la access key
`J7UFcAyfTG1wgVv8qDo2`. Puedes sobreescribirlos en cualquier momento con tus propias credenciales.

### Ejecutar contra Appium local
Asegúrate de tener el servidor Appium 2 corriendo en `127.0.0.1:4723` y expón el binario de la app:
```bash
export APP="/ruta/a/tu/app.apk" # o .ipa
npm test
```

Puedes obtener binarios de ejemplo listos para Android e iOS desde el repositorio de WebdriverIO:
https://github.com/webdriverio/native-demo-app/releases

Usa `APP` para apuntar al `.apk` o `.ipa` descargado (o súbelo a BrowserStack y usa el `bs://...` resultante). Estos binarios
funcionan bien para validar el flujo completo de WebdriverIO + Appium.

## Estructura de carpetas
- `wdio.conf.js`: configuración única para BrowserStack o local.
- `tests/support/`: helpers mínimos para selectors y flujos repetibles.
- `tests/specs/smoke/`: pruebas rápidas de estructura y navegación principal.
- `tests/specs/visual/`: checkpoints visuales que se pueden expandir por vista.
- `tests/specs/sample-login.e2e.js`: ejemplo base y punto de partida para specs nuevas.
- `visual-baseline/`: capturas base generadas automáticamente.
- `visual-output/`: capturas con diferencias y logs visuales.

## Visual testing pixel-perfect
Se usa `wdio-image-comparison-service` para validar la UI. Ejemplos en `tests/specs/sample-login.e2e.js`:
- `browser.saveScreen()` para generar baseline.
- `browser.checkScreen()` y `browser.checkElement()` para comparar que no existan diferencias (se espera `0`).

## Reporte
Se usa el `spec` reporter de WebdriverIO para mantener la salida limpia y legible. Puedes cambiar o agregar reporters en `wdio.conf.js` sin agregar frameworks adicionales como Cucumber.

## Agregar más pruebas
Crea nuevos archivos `*.e2e.js` dentro de `tests/specs/` usando Mocha y los comandos de WebdriverIO. No se necesitan hooks adicionales; las expectativas vienen de `expect-webdriverio` que ya está disponible en el runner.
