const fs = require('node:fs');
const { join } = require('node:path');

const browserStackUser = process.env.BROWSERSTACK_USERNAME || process.env.BROWSERSTACK_USER;
const browserStackKey = process.env.BROWSERSTACK_ACCESS_KEY || process.env.BROWSERSTACK_KEY;
const runOnBrowserStack = Boolean(browserStackUser && browserStackKey);
const platformName = (process.env.PLATFORM_NAME || 'Android').toLowerCase();
const isAndroid = platformName === 'android';
const appId = (() => {
  if (runOnBrowserStack) {
    return process.env.APP || 'bs://ce24671772a8ec2e579c84116a9ca58bf7ecde93';
  }

  const localApp = process.env.APP;

  if (!localApp) {
    throw new Error('APP is required for local runs (path to .apk/.ipa)');
  }

  if (localApp.startsWith('bs://')) {
    throw new Error('Local runs must not use bs:// BrowserStack app ids');
  }

  return localApp;
})();

const services = [];
const specs = ['./tests/specs/**/*.js'];

let suiteHasFailures = false;

const withTimeout = async (promise, ms, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

const updateBrowserStackStatus = async (status, reason) => {
  if (!runOnBrowserStack) {
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
  if (!runOnBrowserStack || !browser?.sessionId) {
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

if (runOnBrowserStack) {
  services.push([
    'browserstack',
    {
      testObservability: false,
      buildIdentifier: null,
    },
  ]);
} else {
  services.push([
    'appium',
    {
      args: { basePath: '/wd/hub' },
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

const baseCaps = {
  platformName: isAndroid ? 'Android' : 'iOS',
  'appium:app': appId,
  'appium:autoAcceptAlerts': false,
  'appium:autoDismissAlerts': false,
  'appium:autoGrantPermissions': true,
  'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
};

const localCaps = {
  ...baseCaps,
  'appium:deviceName': process.env.DEVICE_NAME || (isAndroid ? 'Android Emulator' : 'iPhone Simulator'),
  'appium:platformVersion': process.env.PLATFORM_VERSION || (isAndroid ? '14.0' : '17.0'),
  'appium:udid': process.env.UDID || (isAndroid ? 'emulator-5554' : 'auto'),
};

const bsCaps = {
  ...baseCaps,
  'bstack:options': {
    projectName: process.env.BROWSERSTACK_PROJECT_NAME || 'appium-and-visual-tests',
    buildName: process.env.BROWSERSTACK_BUILD_NAME || 'appium-and-visual-tests',
    sessionName:
      process.env.BROWSERSTACK_SESSION_NAME ||
      `run-${process.env.GITHUB_RUN_ID || process.env.GITHUB_RUN_NUMBER || 'local'}-${new Date().toISOString()}`,
    deviceName: process.env.DEVICE_NAME || (isAndroid ? 'Google Pixel 8' : 'iPhone 15'),
    platformVersion: process.env.PLATFORM_VERSION || (isAndroid ? '14.0' : '17.0'),
    debug: true,
    networkLogs: true,
  },
};

const config = {
  runner: 'local',
  specs,
  maxInstances: 1,
  logLevel: 'info',
  ...(runOnBrowserStack
    ? { user: browserStackUser, key: browserStackKey, hostname: 'hub.browserstack.com', port: 443, path: '/wd/hub' }
    : {
        hostname: process.env.APPIUM_HOST || '127.0.0.1',
        port: Number(process.env.APPIUM_PORT || 4723),
        path: process.env.APPIUM_PATH || '/wd/hub',
      }),
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    timeout: 120000,
  },
  services,
  baseUrl: 'http://localhost',
  capabilities: [runOnBrowserStack ? bsCaps : localCaps],
  waitforTimeout: 20000,
  connectionRetryCount: 2,

  beforeTest: async () => {
    await driver.setTimeout({ implicit: 10000 });
  },

  afterTest: async function (test, context, { error, passed }) {
    suiteHasFailures = suiteHasFailures || Boolean(error);

    if (!passed) {
      fs.mkdirSync(join(process.cwd(), 'visual-output', 'errorShots'), { recursive: true });
      const fileName = `${Date.now()}-${test.title.replace(/[^a-z0-9-_]+/gi, '_')}.png`;
      await browser.saveScreenshot(join('visual-output', 'errorShots', fileName));
    }
  },

};

if (runOnBrowserStack) {
  console.log('[BrowserStack config]', {
    projectName: process.env.BROWSERSTACK_PROJECT_NAME || 'appium-and-visual-tests',
    buildName: process.env.BROWSERSTACK_BUILD_NAME || 'appium-and-visual-tests',
    buildIdentifier: null,
    sessionName:
      process.env.BROWSERSTACK_SESSION_NAME ||
      `run-${process.env.GITHUB_RUN_ID || process.env.GITHUB_RUN_NUMBER || 'local'}-${new Date().toISOString()}`,
  });
}

if (runOnBrowserStack) {
  config.after = () => closeBrowserStackSession(suiteHasFailures);
}

module.exports = { config };
