import { createConfig } from './wdio.base.conf.js';

const runTarget = process.env.RUN_TARGET;
const useBrowserStack = process.env.USE_BROWSERSTACK === 'true';
const isBrowserStack = runTarget === 'browserstack' || useBrowserStack;

if (!isBrowserStack) {
  throw new Error('BrowserStack config requires RUN_TARGET=browserstack or USE_BROWSERSTACK=true.');
}

const browserStackUser = process.env.BROWSERSTACK_USER;
const browserStackKey = process.env.BROWSERSTACK_KEY;

if (!browserStackUser || !browserStackKey) {
  throw new Error('BROWSERSTACK_USER and BROWSERSTACK_KEY must be set for BrowserStack runs.');
}

const platformName = (process.env.PLATFORM_NAME || 'Android').toLowerCase();
const isAndroid = platformName === 'android';
const buildName = process.env.BUILD_NAME || 'mobile-functional-visual';
const appId = process.env.APP;

if (!appId) {
  throw new Error('APP environment variable must point to your BrowserStack app id (bs://...).');
}

const services = [
  [
    'browserstack',
    {
      testObservability: true,
    },
  ],
];

const capabilities = [
  {
    platformName: isAndroid ? 'Android' : 'iOS',
    'appium:app': appId,
    'appium:autoAcceptAlerts': false,
    'appium:autoDismissAlerts': false,
    'appium:autoGrantPermissions': true,
    'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
    'bstack:options': {
      projectName: 'Functional + visual mobile tests',
      buildName,
      sessionName: 'Sample flow',
      deviceName: process.env.DEVICE_NAME || (isAndroid ? 'Google Pixel 8' : 'iPhone 15'),
      platformVersion: process.env.PLATFORM_VERSION || (isAndroid ? '14.0' : '17.0'),
      debug: true,
      networkLogs: true,
    },
  },
];

const config = createConfig({
  services,
  capabilities,
  user: browserStackUser,
  key: browserStackKey,
  isBrowserStack,
});

export { config };
