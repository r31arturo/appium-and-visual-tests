const { join } = require('node:path');

const browserStackUser = 'arevaloasuaje2';
const browserStackKey = 'J7UFcAyfTG1wgVv8qDo2';
const isBrowserStack = Boolean(browserStackUser && browserStackKey);
const platformName = (process.env.PLATFORM_NAME || 'Android').toLowerCase();
const isAndroid = platformName === 'android';
const buildName = process.env.BUILD_NAME || 'mobile-functional-visual';
const appId = process.env.APP || 'bs://ce24671772a8ec2e579c84116a9ca58bf7ecde93';

const services = [];
const specs = ['./tests/specs/**/*.spec.js'];

let suiteHasFailures = false;

const withTimeout = async (promise, ms, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

const updateBrowserStackStatus = async (status, reason) => {
  if (!isBrowserStack) {
    return;
  }

  const executorPayload = `browserstack_executor: ${JSON.stringify({
    action: 'setSessionStatus',
    arguments: { status, reason },
  })}`;

  try {
    await withTimeout(browser.executeScript(executorPayload, []), 4000, 'setSessionStatus');
    console.log(`[BrowserStack] Session marked as ${status}: ${reason}`);
  } catch (error) {
    console.warn('[BrowserStack] Failed to update session status:', error.message);
  }
};

const closeBrowserStackSession = async (hasFailures) => {
  if (!isBrowserStack || !browser?.sessionId) {
    return;
  }

  const status = hasFailures ? 'failed' : 'passed';
  const reason = hasFailures ? 'Suite encountered failures' : 'Suite finished successfully';

  await updateBrowserStackStatus(status, reason);

  try {
    await withTimeout(browser.deleteSession(), 4000, 'deleteSession');
    browser.sessionId = null;
    browser.deleteSession = async () => {};
    console.log('[BrowserStack] Session closed early to avoid idle time');
  } catch (error) {
    console.warn('[BrowserStack] Unable to close session early:', error.message);
  }
};

if (isBrowserStack) {
  services.push([
    'browserstack',
    {
      testObservability: true,
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
  specs,
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
  ],
  waitforTimeout: 20000,
  connectionRetryCount: 2,

  beforeTest: async () => {
    await driver.setTimeout({ implicit: 10000 });
  },

  afterTest: async function (test, context, { error }) {
    suiteHasFailures = suiteHasFailures || Boolean(error);

    if (error) {
      const name = `${test.parent} -- ${test.title}`.replace(/\s+/g, '-').toLowerCase();
      await browser.saveScreenshot(join('visual-output', `${name}.png`));
    }
  },

  after: () => closeBrowserStackSession(suiteHasFailures),
};

module.exports = { config };
