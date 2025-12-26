const { config: baseConfig } = require('./wdio.base.conf');

const runTarget = process.env.RUN_TARGET;
const useBrowserStack = process.env.USE_BROWSERSTACK === 'true';

if (!(runTarget === 'browserstack' || useBrowserStack)) {
  throw new Error('BrowserStack requires RUN_TARGET=browserstack or USE_BROWSERSTACK=true.');
}

const browserStackUser = process.env.BROWSERSTACK_USER;
const browserStackKey = process.env.BROWSERSTACK_KEY;

if (!browserStackUser || !browserStackKey) {
  throw new Error('BROWSERSTACK_USER and BROWSERSTACK_KEY must be set to run on BrowserStack.');
}

const appId = process.env.APP;

if (!appId) {
  throw new Error('APP must point to a BrowserStack app id (bs://...).');
}

const platformName = (process.env.PLATFORM_NAME || 'Android').toLowerCase();
const isAndroid = platformName === 'android';
const buildName = process.env.BUILD_NAME || 'mobile-functional-visual';

let suiteHasFailures = false;

const withTimeout = async (promise, ms, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

const updateBrowserStackStatus = async (status, reason) => {
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
  if (!browser?.sessionId) {
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

const services = [
  ...baseConfig.services,
  [
    'browserstack',
    {
      testObservability: true,
    },
  ],
];

const config = {
  ...baseConfig,
  user: browserStackUser,
  key: browserStackKey,
  services,
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

  afterTest: async function (test, context, result) {
    suiteHasFailures = suiteHasFailures || Boolean(result?.error);
    if (baseConfig.afterTest) {
      await baseConfig.afterTest.call(this, test, context, result);
    }
  },

  after: () => closeBrowserStackSession(suiteHasFailures),
};

module.exports = { config };
