const { join } = require('node:path');

const defaultBrowserStackUser = 'arevaloasuaje2';
const defaultBrowserStackKey = 'J7UFcAyfTG1wgVv8qDo2';
const browserStackUser = process.env.BROWSERSTACK_USER || defaultBrowserStackUser;
const browserStackKey = process.env.BROWSERSTACK_KEY || defaultBrowserStackKey;
const isBrowserStack = Boolean(browserStackUser && browserStackKey);
const platformName = (process.env.PLATFORM_NAME || 'Android').toLowerCase();
const isAndroid = platformName === 'android';
const buildName = process.env.BUILD_NAME || 'mobile-functional-visual';
const appId = process.env.APP || 'bs://ce24671772a8ec2e579c84116a9ca58bf7ecde93';

const services = [];

const updateBrowserStackStatus = async (status, reason) => {
  if (!isBrowserStack) {
    return;
  }

  const executorPayload = `browserstack_executor: ${JSON.stringify({
    action: 'setSessionStatus',
    arguments: { status, reason },
  })}`;

  try {
    await browser.executeScript(executorPayload, []);
    console.log(`[BrowserStack] Session marked as ${status}: ${reason}`);
  } catch (error) {
    console.warn('[BrowserStack] Failed to update session status:', error.message);
  }
};

if (isBrowserStack) {
  services.push([
    'browserstack',
    {
      testObservability: true,
    },
  ]);
} else {
  services.push([
    'appium',
    {
      args: {
        address: '127.0.0.1',
        port: 4723,
      },
      command: 'appium',
    },
  ]);
}

services.push([
  'visual',
  {
    baselineFolder: join(process.cwd(), 'visual-baseline'),
    screenshotPath: join(process.cwd(), 'visual-output'),
    formatImageName: '{tag}-{platformName}-{deviceName}-{width}x{height}',
    savePerInstance: true,
    autoSaveBaseline: true,
  },
]);

const config = {
  runner: 'local',
  specs: ['./tests/specs/**/*.e2e.js'],
  maxInstances: 1,
  logLevel: 'info',
  user: browserStackUser,
  key: browserStackKey,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    timeout: 120000,
  },
  services,
  baseUrl: 'http://localhost',
  capabilities: [
    isBrowserStack
      ? {
          platformName: isAndroid ? 'Android' : 'iOS',
          'appium:app': appId,
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
          }
        : {
            platformName: isAndroid ? 'Android' : 'iOS',
            'appium:deviceName':
            process.env.DEVICE_NAME || (isAndroid ? 'Android Emulator' : 'iPhone Simulator'),
          'appium:platformVersion': process.env.PLATFORM_VERSION || (isAndroid ? '14.0' : '17.0'),
          'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
          'appium:app': appId,
          'appium:autoGrantPermissions': true,
        },
  ],
  waitforTimeout: 20000,
  connectionRetryCount: 2,

  beforeTest: async () => {
    await driver.setTimeout({ implicit: 10000 });
  },

  afterTest: async function (test, context, { error }) {
    const testStatus = error ? 'failed' : 'passed';
    const reason = error
      ? `${test.title} failed: ${error.message}`
      : `${test.title} passed`;

    await updateBrowserStackStatus(testStatus, reason);

    if (error) {
      const name = `${test.parent} -- ${test.title}`.replace(/\s+/g, '-').toLowerCase();
      await browser.saveScreenshot(join('visual-output', `${name}.png`));
    }
  },
};

module.exports = { config };
