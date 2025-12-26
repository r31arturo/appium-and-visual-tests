const { config: baseConfig } = require('./wdio.base.conf');

const runTarget = process.env.RUN_TARGET || 'local';
const useBrowserStack = process.env.USE_BROWSERSTACK === 'true';

if (runTarget === 'browserstack' || useBrowserStack) {
  throw new Error('BrowserStack config requested. Use wdio.browserstack.conf.js instead of wdio.local.conf.js.');
}

const appPath = process.env.APP;

if (!appPath) {
  throw new Error('APP must point to a local .apk/.ipa when running against Appium local.');
}

const services = [
  ...baseConfig.services,
  [
    'appium',
    {
      command: 'appium',
      args: {
        address: '127.0.0.1',
        port: 4723,
        logLevel: 'error',
      },
    },
  ],
];

const config = {
  ...baseConfig,
  hostname: '127.0.0.1',
  port: 4723,
  services,
  capabilities: [
    {
      platformName: 'Android',
      'appium:app': appPath,
      'appium:autoAcceptAlerts': false,
      'appium:autoDismissAlerts': false,
      'appium:autoGrantPermissions': true,
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': process.env.DEVICE_NAME || 'Android Emulator',
      'appium:platformVersion': process.env.PLATFORM_VERSION || '14.0',
    },
  ],
};

module.exports = { config };
