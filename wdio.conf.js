const fs = require('node:fs');
const { join, sep } = require('node:path');
const { execSync } = require('node:child_process');
const mergeResults = require('wdio-mochawesome-reporter/mergeResults');
const sharp = require('sharp');

const reportDir = join(process.cwd(), 'report');
const reportDirs = {
  visualBaseline: join(reportDir, 'visual-baseline'),
  visualOutput: join(reportDir, 'visual-output'),
  junit: join(reportDir, 'junit'),
  mochawesomeJson: join(reportDir, 'mochawesome-json'),
  mochawesomeScreenshots: join(reportDir, 'mochawesome-screenshots'),
};

fs.mkdirSync(reportDir, { recursive: true });
Object.values(reportDirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
const wdioLogLevel = process.env.WDIO_LOG_LEVEL || 'info';
const appiumLogLevel = process.env.APPIUM_LOG_LEVEL || 'info';
const showXcodeLog = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.IOS_SHOW_XCODE_LOG || '').toLowerCase(),
);
const appiumLogPath = process.env.APPIUM_LOG_PATH || (isCI ? join(reportDir, 'appium.log') : '');
const enableVisualComparison = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VISUAL_COMPARE || '').toLowerCase(),
);
const runModeLabel = enableVisualComparison ? 'Visual' : 'Functional';
const reportFileName = enableVisualComparison ? 'mochawesome-visual' : 'mochawesome-functional';
const normalizeReportScreenshotDowngrade = (value, fallback) => {
  const raw = typeof value === 'string' ? value.trim() : value;

  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = parsed > 1 ? parsed / 100 : parsed;

  if (normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.max(normalized, 0.2), 1);
};
const normalizePositiveInt = (value, fallback) => {
  const raw = typeof value === 'string' ? value.trim() : value;

  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};
// REPORT_SCREENSHOT_DOWNSCALE (0-1 or 0-100) controls mochawesome-only downgrade; 1 disables.
const reportScreenshotScale = normalizeReportScreenshotDowngrade(
  process.env.REPORT_SCREENSHOT_DOWNSCALE,
  0.3,
);
const reportScreenshotQuality = Math.min(100, Math.max(20, Math.round(reportScreenshotScale * 100)));
const reportScreenshotSettings = {
  scale: reportScreenshotScale,
  quality: reportScreenshotQuality,
};
const shouldCompressReportScreenshots = reportScreenshotSettings.scale < 1;
const finalScreenshotMarker = '__FINAL_SCREENSHOT__'; // Sentinel to relabel the next screenshot in Mochawesome.
const finalScreenshotLabel = '!!! FINAL SCREENSHOT (TEST PASSED) !!!';
const failureScreenshotMarker = '__FAILURE_SCREENSHOT__';
const failureScreenshotLabel = '!!! FAILURE SCREENSHOT (TEST FAILED) !!!';
const screenshotLabelMap = {
  [finalScreenshotMarker]: finalScreenshotLabel,
  [failureScreenshotMarker]: failureScreenshotLabel,
};
const dataUrlPattern = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/;

const listFilesRecursive = (dir) => {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
};

const resolveOutputFormat = (formatHint, metadataFormat) => {
  const hint = typeof formatHint === 'string' ? formatHint.toLowerCase() : '';

  if (hint === 'jpg' || hint === 'jpeg') {
    return 'jpeg';
  }

  if (hint === 'png') {
    return 'png';
  }

  return metadataFormat === 'jpeg' ? 'jpeg' : 'png';
};

const compressImageBuffer = async (buffer, formatHint, settings) => {
  const image = sharp(buffer, { failOnError: false });
  const metadata = await image.metadata();
  let pipeline = image;

  if (settings.scale < 1 && (metadata.width || metadata.height)) {
    const width = metadata.width ? Math.max(1, Math.round(metadata.width * settings.scale)) : null;
    const height = metadata.height ? Math.max(1, Math.round(metadata.height * settings.scale)) : null;
    pipeline = pipeline.resize({ width, height, fit: 'inside', withoutEnlargement: true });
  }

  const outputFormat = resolveOutputFormat(formatHint, metadata.format);

  if (outputFormat === 'jpeg') {
    const outputBuffer = await pipeline.jpeg({ quality: settings.quality, mozjpeg: true }).toBuffer();
    return { buffer: outputBuffer, mime: 'image/jpeg' };
  }

  const colorCount = Math.min(256, Math.max(8, Math.round(256 * (settings.quality / 100))));
  const outputBuffer = await pipeline
    .png({ compressionLevel: 9, palette: true, quality: settings.quality, colors: colorCount })
    .toBuffer();

  return { buffer: outputBuffer, mime: 'image/png' };
};

const compressDataUrl = async (dataUrl, settings) => {
  const match = dataUrlPattern.exec(dataUrl);

  if (!match) {
    return null;
  }

  const formatHint = match[1];
  const inputBuffer = Buffer.from(match[2], 'base64');
  const output = await compressImageBuffer(inputBuffer, formatHint, settings);

  if (!output) {
    return null;
  }

  if (output.buffer.length >= inputBuffer.length) {
    return dataUrl;
  }

  return `data:${output.mime};base64,${output.buffer.toString('base64')}`;
};

const applyScreenshotLabels = (context) => {
  if (!Array.isArray(context)) {
    return { value: context, changed: false };
  }

  let changed = false;
  const updated = [];
  let pendingLabel = null;

  for (const entry of context) {
    if (entry && typeof entry === 'object' && screenshotLabelMap[entry.title]) {
      pendingLabel = screenshotLabelMap[entry.title];
      changed = true;
      continue;
    }

    if (pendingLabel && entry && typeof entry === 'object' && entry.title === 'Screenshot') {
      updated.push({ ...entry, title: pendingLabel });
      pendingLabel = null;
      changed = true;
      continue;
    }

    updated.push(entry);
  }

  return { value: updated, changed };
};

const compressContextEntry = async (entry, settings, shouldCompress) => {
  if (!shouldCompress) {
    return { value: entry, changed: false };
  }

  if (!entry || typeof entry !== 'object') {
    return { value: entry, changed: false };
  }

  if (typeof entry.value !== 'string') {
    return { value: entry, changed: false };
  }

  if (!dataUrlPattern.test(entry.value)) {
    return { value: entry, changed: false };
  }

  const compressed = await compressDataUrl(entry.value, settings);

  if (!compressed || compressed === entry.value) {
    return { value: entry, changed: false };
  }

  return { value: { ...entry, value: compressed }, changed: true };
};

const compressContextValue = async (context, settings, shouldCompress) => {
  if (Array.isArray(context)) {
    let changed = false;
    const updated = [];
    const labelResult = applyScreenshotLabels(context);
    changed = changed || labelResult.changed;

    for (const entry of labelResult.value) {
      const result = await compressContextEntry(entry, settings, shouldCompress);
      updated.push(result.value);
      changed = changed || result.changed;
    }

    return { value: updated, changed };
  }

  if (context && typeof context === 'object') {
    return compressContextEntry(context, settings, shouldCompress);
  }

  return { value: context, changed: false };
};

const compressItemContext = async (item, settings, shouldCompress) => {
  if (!item || typeof item.context !== 'string') {
    return false;
  }

  let parsed;

  try {
    parsed = JSON.parse(item.context);
  } catch (error) {
    return false;
  }

  const { value, changed } = await compressContextValue(parsed, settings, shouldCompress);

  if (!changed) {
    return false;
  }

  item.context = JSON.stringify(value);
  return true;
};

const compressSuiteContexts = async (suite, settings, shouldCompress) => {
  if (!suite) {
    return false;
  }

  let changed = false;

  if (Array.isArray(suite.tests)) {
    for (const test of suite.tests) {
      changed = (await compressItemContext(test, settings, shouldCompress)) || changed;
    }
  }

  if (Array.isArray(suite.beforeHooks)) {
    for (const hook of suite.beforeHooks) {
      changed = (await compressItemContext(hook, settings, shouldCompress)) || changed;
    }
  }

  if (Array.isArray(suite.afterHooks)) {
    for (const hook of suite.afterHooks) {
      changed = (await compressItemContext(hook, settings, shouldCompress)) || changed;
    }
  }

  if (Array.isArray(suite.suites)) {
    for (const child of suite.suites) {
      changed = (await compressSuiteContexts(child, settings, shouldCompress)) || changed;
    }
  }

  return changed;
};

const compressMochawesomeJsonScreenshots = async (filePath, settings) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  let data;

  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.warn('[Mochawesome] Failed to read merged JSON for compression:', error.message);
    return;
  }

  let changed = false;
  const results = Array.isArray(data.results) ? data.results : [];

  for (const result of results) {
    const suites = Array.isArray(result.suites) ? result.suites : [];

    for (const suite of suites) {
      changed = (await compressSuiteContexts(suite, settings, shouldCompressReportScreenshots)) || changed;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(data));
  }
};

const compressMochawesomeScreenshotFiles = async (dir, settings) => {
  if (!shouldCompressReportScreenshots || !fs.existsSync(dir)) {
    return;
  }

  const files = listFilesRecursive(dir).filter((filePath) => /\.(png|jpe?g)$/i.test(filePath));

  for (const filePath of files) {
    try {
      const inputBuffer = fs.readFileSync(filePath);
      const extension = filePath.split('.').pop() || '';
      const output = await compressImageBuffer(inputBuffer, extension, settings);

      if (!output || output.buffer.length >= inputBuffer.length) {
        continue;
      }

      const tempPath = `${filePath}.tmp`;
      fs.writeFileSync(tempPath, output.buffer);
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      console.warn(`[Mochawesome] Failed to compress ${filePath}: ${error.message}`);
    }
  }
};

const browserStackUser = process.env.BROWSERSTACK_USERNAME || process.env.BROWSERSTACK_USER;
const browserStackKey = process.env.BROWSERSTACK_ACCESS_KEY || process.env.BROWSERSTACK_KEY;
const runOnBrowserStack = Boolean(browserStackUser && browserStackKey);
const platformName = (process.env.PLATFORM_NAME || 'Android').toLowerCase();
const isAndroid = platformName === 'android';
const iosSimulatorStartupTimeout = normalizePositiveInt(
  process.env.IOS_SIMULATOR_STARTUP_TIMEOUT,
  isCI ? 300000 : 120000,
);
const iosWdaLaunchTimeout = normalizePositiveInt(process.env.IOS_WDA_LAUNCH_TIMEOUT, isCI ? 240000 : 120000);
const iosWdaConnectionTimeout = normalizePositiveInt(
  process.env.IOS_WDA_CONNECTION_TIMEOUT,
  isCI ? 240000 : 120000,
);
const connectionRetryTimeout = normalizePositiveInt(
  process.env.WDIO_CONNECTION_RETRY_TIMEOUT,
  isCI && !isAndroid ? 300000 : 120000,
);
const findLocalApp = () => {
  const appsDir = join(process.cwd(), 'apps');

  if (!fs.existsSync(appsDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(appsDir)
    .filter((file) => file.endsWith('.apk') || file.endsWith('.ipa'))
    .map((file) => join(appsDir, file));

  return candidates[0] || null;
};
const appId = (() => {
  if (runOnBrowserStack) {
    return process.env.APP || 'bs://ce24671772a8ec2e579c84116a9ca58bf7ecde93';
  }

  const localApp = process.env.APP || findLocalApp();

  if (!localApp) {
    throw new Error(
      'APP is required for local runs (path to .apk/.ipa). Example: APP=./apps/tu.apk npm run test:ci:login',
    );
  }

  if (localApp.startsWith('bs://')) {
    throw new Error('Local runs must not use bs:// BrowserStack app ids');
  }

  return localApp;
})();

const services = [];
const specs = ['./tests/specs/**/*.js'];

let suiteHasFailures = false;
let actionScreenshotHooksInstalled = false;
let isInTest = false;

const withTimeout = async (promise, ms, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

const buildActionLabel = (element, actionName) => {
  const selector = typeof element?.selector === 'string' ? element.selector : '';
  return selector ? `Before ${actionName} (${selector})` : `Before ${actionName}`;
};

const captureActionScreenshot = async (element, actionName) => {
  if (!isInTest) {
    return;
  }

  let exists = false;

  try {
    exists = await element.isExisting();
  } catch (error) {
    return;
  }

  if (!exists) {
    return;
  }

  process.emit('wdio-mochawesome-reporter:addContext', {
    title: 'Step',
    value: buildActionLabel(element, actionName),
  });

  try {
    await browser.takeScreenshot();
  } catch (error) {
    console.warn(`[Screenshot] Failed before ${actionName}: ${error.message}`);
  }
};

const installActionScreenshotHooks = () => {
  if (actionScreenshotHooksInstalled) {
    return;
  }

  actionScreenshotHooksInstalled = true;
  const commandsToCapture = ['click', 'setValue', 'addValue', 'clearValue'];

  commandsToCapture.forEach((commandName) => {
    browser.overwriteCommand(
      commandName,
      async function (origCommand, ...args) {
        await captureActionScreenshot(this, commandName);
        return origCommand.apply(this, args);
      },
      true,
    );
  });
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
  const appiumServiceOptions = {
    args: {
      basePath: '/wd/hub',
      logLevel: appiumLogLevel,
    },
  };

  if (appiumLogPath) {
    appiumServiceOptions.logPath = appiumLogPath;
  }

  services.push(['appium', appiumServiceOptions]);
}

if (enableVisualComparison) {
  services.push([
    'visual',
    {
      baselineFolder: reportDirs.visualBaseline,
      screenshotPath: reportDirs.visualOutput,
      formatImageName: '{tag}-{platformName}-{deviceName}-{width}x{height}',
      savePerInstance: true,
      autoSaveBaseline: true,
    },
  ]);
}

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
const localCapsWithIosTuning = isAndroid
  ? localCaps
  : {
      ...localCaps,
      'appium:simulatorStartupTimeout': iosSimulatorStartupTimeout,
      'appium:wdaLaunchTimeout': iosWdaLaunchTimeout,
      'appium:wdaConnectionTimeout': iosWdaConnectionTimeout,
      ...(showXcodeLog ? { 'appium:showXcodeLog': true } : {}),
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
  logLevel: wdioLogLevel,
  ...(runOnBrowserStack
    ? { user: browserStackUser, key: browserStackKey, hostname: 'hub.browserstack.com', port: 443, path: '/wd/hub' }
    : {
        hostname: process.env.APPIUM_HOST || '127.0.0.1',
        port: Number(process.env.APPIUM_PORT || 4723),
        path: process.env.APPIUM_PATH || '/wd/hub',
      }),
  framework: 'mocha',
  reporters: [
    'spec',
    [
      'mochawesome',
      {
        outputDir: reportDirs.mochawesomeJson,
        outputFileFormat: (opts) => `results-${opts.cid}.json`,
      },
    ],
    ...(isCI
      ? [
          [
            'junit',
            {
              outputDir: reportDirs.junit,
              outputFileFormat: (opts) => `wdio-${opts.cid}.xml`,
            },
          ],
        ]
      : []),
  ],
  mochawesomeOpts: {
    includeScreenshots: true,
    screenshotUseRelativePath: true,
  },
  mochaOpts: {
    timeout: 120000,
  },
  services,
  baseUrl: 'http://localhost',
  capabilities: [runOnBrowserStack ? bsCaps : localCapsWithIosTuning],
  waitforTimeout: 20000,
  connectionRetryTimeout,
  connectionRetryCount: 2,

  before: async () => {
    installActionScreenshotHooks();
  },

  beforeTest: async () => {
    isInTest = true;
    await driver.setTimeout({ implicit: 10000 });
  },

  afterTest: async function (test, context, { error, passed }) {
    suiteHasFailures = suiteHasFailures || Boolean(error);
    const sanitizedTitle = test.title.replace(/[^a-z0-9-_]+/gi, '_');

    if (!passed) {
      const fileName = `${Date.now()}-${sanitizedTitle}.png`;
      const visualErrorDir = join(reportDirs.visualOutput, 'errorShots');
      const mochawesomeShotsDir = reportDirs.mochawesomeScreenshots;
      const mochawesomeShotPath = join(mochawesomeShotsDir, fileName);
      const visualShotPath = join(visualErrorDir, fileName);
      fs.mkdirSync(mochawesomeShotsDir, { recursive: true });
      fs.mkdirSync(visualErrorDir, { recursive: true });

      process.emit('wdio-mochawesome-reporter:addContext', {
        title: failureScreenshotMarker,
        value: true,
      });
      await browser.saveScreenshot(mochawesomeShotPath);
      fs.copyFileSync(mochawesomeShotPath, visualShotPath);
    } else {
      const fileName = `${Date.now()}-${sanitizedTitle}-final.png`;
      const mochawesomeShotsDir = reportDirs.mochawesomeScreenshots;
      const mochawesomeShotPath = join(mochawesomeShotsDir, fileName);
      fs.mkdirSync(mochawesomeShotsDir, { recursive: true });

      try {
        process.emit('wdio-mochawesome-reporter:addContext', {
          title: finalScreenshotMarker,
          value: true,
        });
        await browser.saveScreenshot(mochawesomeShotPath);
      } catch (error) {
        console.warn(`[Screenshot] Failed final capture for ${test.title}: ${error.message}`);
      }
    }

    isInTest = false;
  },
  onComplete: async () => {
    const resultsDir = reportDirs.mochawesomeJson;
    const mergedFile = join(resultsDir, 'wdio-ma-merged.json');
    const resultFiles = fs.existsSync(resultsDir)
      ? fs.readdirSync(resultsDir).filter((file) => file.match(/results-.*\.json$/))
      : [];

    if (resultFiles.length === 0) {
      console.warn('[Mochawesome] No JSON results found, skipping report generation.');
      return;
    }

    fs.mkdirSync(reportDir, { recursive: true });
    await mergeResults(resultsDir, 'results-.*\\.json$');

    if (!fs.existsSync(mergedFile) && resultFiles.length === 1) {
      fs.copyFileSync(join(resultsDir, resultFiles[0]), mergedFile);
    }

    if (!fs.existsSync(mergedFile)) {
      console.warn('[Mochawesome] Merged JSON not found, skipping report generation.');
      return;
    }

    await compressMochawesomeJsonScreenshots(mergedFile, reportScreenshotSettings);

    if (shouldCompressReportScreenshots) {
      console.log(
        `[Mochawesome] Downscaling report screenshots to ${Math.round(
          reportScreenshotSettings.scale * 100,
        )}%`,
      );
      await compressMochawesomeScreenshotFiles(reportDirs.mochawesomeScreenshots, reportScreenshotSettings);
    }

    const reportTitle = `Mochawesome - ${runModeLabel}`;
    const reportPageTitle = `Tests (${runModeLabel})`;
    execSync(
      `npx marge --inline ${mergedFile} -o ${reportDir} -f ${reportFileName} -t "${reportTitle}" -p "${reportPageTitle}"`,
      { stdio: 'inherit' },
    );
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
