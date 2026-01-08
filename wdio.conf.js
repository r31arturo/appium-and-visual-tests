const { join } = require('node:path');
const fs = require('node:fs');

const browserStackUser = process.env.BROWSERSTACK_USER || process.env.BROWSERSTACK_USERNAME;
const browserStackKey = process.env.BROWSERSTACK_KEY || process.env.BROWSERSTACK_ACCESS_KEY;
const isBrowserStack = Boolean(browserStackUser && browserStackKey);
const platformName = (process.env.PLATFORM_NAME || 'Android').toLowerCase();
const isAndroid = platformName === 'android';
const appId = (() => {
  if (isBrowserStack) {
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

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || join(process.cwd(), 'artifacts', 'evidence');
const EVIDENCE_VIDEO_ENABLED = /^(1|true)$/i.test(process.env.EVIDENCE_VIDEO || '');
const EVIDENCE_VIDEO_TIME_LIMIT = String(Number(process.env.EVIDENCE_VIDEO_TIME_LIMIT || 180));

const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
};

const safeFilename = (value) =>
  String(value)
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 180);

const nowForFilename = () => new Date().toISOString().replace(/[:.]/g, '-');

let videoRecordingActive = false;

const startLocalVideoRecording = async () => {
  if (!EVIDENCE_VIDEO_ENABLED || isBrowserStack || videoRecordingActive) return;

  try {
    await driver.startRecordingScreen({ timeLimit: EVIDENCE_VIDEO_TIME_LIMIT });
    videoRecordingActive = true;
  } catch (error) {
    videoRecordingActive = false;
    console.warn('[Evidence] startRecordingScreen failed:', error.message);
  }
};

const stopLocalVideoRecording = async () => {
  if (!EVIDENCE_VIDEO_ENABLED || isBrowserStack || !videoRecordingActive) return null;

  try {
    const base64Video = await driver.stopRecordingScreen();
    videoRecordingActive = false;
    return base64Video;
  } catch (error) {
    videoRecordingActive = false;
    console.warn('[Evidence] stopRecordingScreen failed:', error.message);
    return null;
  }
};

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
  const BS_PROJECT_NAME = process.env.BROWSERSTACK_PROJECT_NAME || 'appium-and-visual-tests';
  const BS_BUILD_NAME = process.env.BROWSERSTACK_BUILD_NAME || 'appium-and-visual-tests';
  const BS_SESSION_NAME =
    process.env.BROWSERSTACK_SESSION_NAME ||
    `run-${process.env.GITHUB_RUN_ID || process.env.GITHUB_RUN_NUMBER || 'local'}-${new Date().toISOString()}`;

  services.push([
    'browserstack',
    {
      testObservability: false,
      buildIdentifier: null,
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

const capabilities = {
  platformName: isAndroid ? 'Android' : 'iOS',
  'appium:app': appId,
  'appium:autoAcceptAlerts': false,
  'appium:autoDismissAlerts': false,
  'appium:autoGrantPermissions': true,
  'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
};

if (isBrowserStack) {
  capabilities['bstack:options'] = {
    projectName: process.env.BROWSERSTACK_PROJECT_NAME || 'appium-and-visual-tests',
    buildName: process.env.BROWSERSTACK_BUILD_NAME || 'appium-and-visual-tests',
    sessionName:
      process.env.BROWSERSTACK_SESSION_NAME ||
      `run-${process.env.GITHUB_RUN_ID || process.env.GITHUB_RUN_NUMBER || 'local'}-${new Date().toISOString()}`,
    deviceName: process.env.DEVICE_NAME || (isAndroid ? 'Google Pixel 8' : 'iPhone 15'),
    platformVersion: process.env.PLATFORM_VERSION || (isAndroid ? '14.0' : '17.0'),
    debug: true,
    networkLogs: true,
  };
}

if (!isBrowserStack) {
  capabilities['appium:deviceName'] =
    process.env.DEVICE_NAME || (isAndroid ? 'Android Emulator' : 'iPhone Simulator');
  capabilities['appium:platformVersion'] = process.env.PLATFORM_VERSION || (isAndroid ? '14.0' : '17.0');
}

const config = {
  runner: 'local',
  specs,
  maxInstances: 1,
  logLevel: 'info',
  ...(isBrowserStack
    ? { user: browserStackUser, key: browserStackKey }
    : {
        hostname: process.env.APPIUM_HOST || '127.0.0.1',
        port: Number(process.env.APPIUM_PORT || 4723),
        path: process.env.APPIUM_PATH || '/',
      }),
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    timeout: 120000,
  },
  services,
  baseUrl: 'http://localhost',
  capabilities: [capabilities],
  waitforTimeout: 20000,
  connectionRetryCount: 2,

  beforeTest: async function () {
    await driver.setTimeout({ implicit: 10000 });
    await startLocalVideoRecording();
  },

  afterTest: async function (test, context, { error }) {
    suiteHasFailures = suiteHasFailures || Boolean(error);

    const testId = safeFilename(`${test.parent}--${test.title}`);
    const stamp = nowForFilename();
    const caps = driver?.capabilities || {};
    const deviceName = safeFilename(
      caps.deviceName || caps['appium:deviceName'] || process.env.DEVICE_NAME || (isAndroid ? 'Android Emulator' : 'iPhone Simulator'),
    );
    const platformVersion = safeFilename(
      caps.platformVersion || caps['appium:platformVersion'] || process.env.PLATFORM_VERSION || (isAndroid ? '14.0' : '17.0'),
    );
    const evidenceBase = safeFilename(`${platformName}-${platformVersion}-${deviceName}`);

    const baseName = `${stamp}-${evidenceBase}-${testId}`;

    // Stop recording for every test if enabled. Only keep the file when the test failed.
    const base64Video = await stopLocalVideoRecording();
    if (base64Video && error) {
      const videosDir = join(EVIDENCE_DIR, 'videos');
      ensureDir(videosDir);
      fs.writeFileSync(join(videosDir, `${baseName}.mp4`), Buffer.from(base64Video, 'base64'));
    }

    if (error) {
      const screenshotsDir = join(EVIDENCE_DIR, 'screenshots');
      ensureDir(screenshotsDir);
      await browser.saveScreenshot(join(screenshotsDir, `${baseName}.png`));

      try {
        const pageSourceDir = join(EVIDENCE_DIR, 'page-source');
        ensureDir(pageSourceDir);
        const pageSource = await driver.getPageSource();
        fs.writeFileSync(join(pageSourceDir, `${baseName}.xml`), pageSource, 'utf8');
      } catch (pageSourceError) {
        console.warn('[Evidence] getPageSource failed:', pageSourceError.message);
      }
    }
  },

};

if (isBrowserStack) {
  console.log('[BrowserStack config]', {
    projectName: process.env.BROWSERSTACK_PROJECT_NAME || 'appium-and-visual-tests',
    buildName: process.env.BROWSERSTACK_BUILD_NAME || 'appium-and-visual-tests',
    buildIdentifier: null,
    sessionName:
      process.env.BROWSERSTACK_SESSION_NAME ||
      `run-${process.env.GITHUB_RUN_ID || process.env.GITHUB_RUN_NUMBER || 'local'}-${new Date().toISOString()}`,
  });
}

if (isBrowserStack) {
  config.after = () => closeBrowserStackSession(suiteHasFailures);
}

module.exports = { config };
