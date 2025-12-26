import { join } from 'node:path';

const specs = ['./tests/specs/**/*.spec.js', './tests/specs/**/*.spec.mjs'];

const visualService = [
  'visual',
  {
    baselineFolder: join(process.cwd(), 'visual-baseline'),
    screenshotPath: join(process.cwd(), 'visual-output'),
    formatImageName: '{tag}-{platformName}-{deviceName}-{width}x{height}',
    savePerInstance: true,
    autoSaveBaseline: true,
  },
];

const withTimeout = async (promise, ms, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

const createConfig = ({
  services = [],
  capabilities,
  hostname,
  port,
  user,
  key,
  isBrowserStack = false,
}) => {
  let suiteHasFailures = false;

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

  return {
    runner: 'local',
    specs,
    maxInstances: 1,
    logLevel: 'info',
    user,
    key,
    framework: 'mocha',
    reporters: ['spec'],
    mochaOpts: {
      timeout: 120000,
    },
    services: [...services, visualService],
    baseUrl: 'http://localhost',
    capabilities,
    waitforTimeout: 20000,
    connectionRetryCount: 2,
    hostname,
    port,

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
};

export { createConfig };
