import { createConfig } from './wdio.base.conf.js';

const platformName = (process.env.PLATFORM_NAME || 'Android').toLowerCase();
const isAndroid = platformName === 'android';
const appId = process.env.APP;

if (!appId) {
  throw new Error('APP environment variable is required for local Appium runs.');
}

const services = [
  [
    'appium',
    {
      logPath: './',
      args: {
        basePath: '/',
        address: '127.0.0.1',
        port: 4723,
        logLevel: 'info',
      },
    },
  ],
];

const capabilities = [
  {
    maxInstances: 1,
    platformName: isAndroid ? 'Android' : 'iOS',
    'appium:app': appId,
    'appium:autoAcceptAlerts': false,
    'appium:autoDismissAlerts': false,
    'appium:autoGrantPermissions': true,
    'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
    'appium:deviceName': process.env.DEVICE_NAME || (isAndroid ? 'Android Emulator' : 'iPhone 15'),
    'appium:platformVersion': process.env.PLATFORM_VERSION,
  },
];

const config = createConfig({
  services,
  capabilities,
  hostname: '127.0.0.1',
  port: 4723,
});

export { config };
