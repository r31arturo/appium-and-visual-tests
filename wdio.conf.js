const fs = require('node:fs');
const { join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { execSync } = require('node:child_process');
const mergeResults = require('wdio-mochawesome-reporter/mergeResults');
let sharp = null;
let sharpLoadError = null;
const visualFailureMessagesByTest = new Map();

try {
  const WdioMochawesomeReporter = require('wdio-mochawesome-reporter').default;

  if (WdioMochawesomeReporter?.prototype?.onAfterCommand) {
    WdioMochawesomeReporter.prototype.onAfterCommand = function patchedOnAfterCommand() {};
  }
} catch (error) {
}

import(pathToFileURL(join(process.cwd(), 'node_modules/@wdio/spec-reporter/build/index.js')).href)
  .then((module) => {
    const SpecReporter = module?.default;

    if (!SpecReporter?.prototype?.onRunnerEnd) {
      return;
    }

    const originalOnRunnerEnd = SpecReporter.prototype.onRunnerEnd;

    SpecReporter.prototype.onRunnerEnd = function patchedOnRunnerEnd(runner) {
      let promotedFailures = 0;
      const suites = typeof this.getOrderedSuites === 'function' ? this.getOrderedSuites() : [];

      for (const suite of suites) {
        const tests = Array.isArray(suite?.tests) ? suite.tests : [];

        for (const test of tests) {
          const visualFailureMessage =
            visualFailureMessagesByTest.get(test?.fullTitle) || visualFailureMessagesByTest.get(test?.title);

          if (!visualFailureMessage || test?.state !== 'passed') {
            continue;
          }

          promotedFailures += 1;
          test.state = 'failed';
          test.errors = [
            {
              message: visualFailureMessage,
            },
          ];
          test.error = test.errors[0];
        }
      }

      if (promotedFailures > 0) {
        this._stateCounts.passed = Math.max(0, this._stateCounts.passed - promotedFailures);
        this._stateCounts.failed += promotedFailures;
      }

      return originalOnRunnerEnd.call(this, runner);
    };
  })
  .catch(() => {});

import(pathToFileURL(join(process.cwd(), 'node_modules/@wdio/cli/build/index.js')).href)
  .then((module) => {
    const Launcher = module?.Launcher;

    if (!Launcher?.prototype?._endHandler) {
      return;
    }

    const originalEndHandler = Launcher.prototype._endHandler;

    Launcher.prototype._endHandler = async function patchedEndHandler(payload) {
      let nextPayload = payload;

      if (payload?.exitCode === 0 && fs.existsSync(pendingVisualResultsFile)) {
        nextPayload = { ...payload, exitCode: 1 };
      }

      return originalEndHandler.call(this, nextPayload);
    };
  })
  .catch(() => {});

try {
  sharp = require('sharp');
} catch (error) {
  sharpLoadError = error;
}

const reportDir = join(process.cwd(), 'report');
const reportDirs = {
  visualBaseline: join(reportDir, 'visual-baseline'),
  visualOutput: join(reportDir, 'visual-output'),
  junit: join(reportDir, 'junit'),
  pageSource: join(reportDir, 'page-source'),
  mochawesomeJson: join(reportDir, 'mochawesome-json'),
  mochawesomeScreenshots: join(reportDir, 'mochawesome-screenshots'),
};
const pendingVisualResultsFile = join(reportDir, 'visual-pending-tests.json');

fs.mkdirSync(reportDir, { recursive: true });
Object.values(reportDirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
const wdioLogLevel = process.env.WDIO_LOG_LEVEL || 'info';
const webdriverLogLevel = process.env.WDIO_WEBDRIVER_LOG_LEVEL || 'info';
const appiumLogLevel = process.env.APPIUM_LOG_LEVEL || 'info';
const showXcodeLog = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.IOS_SHOW_XCODE_LOG || '').toLowerCase(),
);
const appiumLogPath = process.env.APPIUM_LOG_PATH || (isCI ? join(reportDir, 'appium.log') : '');
const enableVisualComparison = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VISUAL_COMPARE || '').toLowerCase(),
);
const rawCollectAllVisualDifferences = String(process.env.VISUAL_COLLECT_ALL_DIFFERENCES || '').toLowerCase();
const collectAllVisualDifferences =
  enableVisualComparison && !['0', 'false', 'no', 'off'].includes(rawCollectAllVisualDifferences);
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
const normalizeAppiumServiceLogLevel = (value) => {
  const normalized = String(value || 'info').trim().toLowerCase();
  return ['trace', 'debug', 'info'].includes(normalized) ? normalized : 'info';
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
const reportScreenshotDisplayWidth = normalizePositiveInt(
  process.env.REPORT_SCREENSHOT_DISPLAY_WIDTH,
  null,
);
const shouldCompressReportScreenshots = reportScreenshotSettings.scale < 1 && Boolean(sharp);
if (reportScreenshotSettings.scale < 1 && !sharp) {
  const errorMessage = sharpLoadError && sharpLoadError.message ? ` (${sharpLoadError.message})` : '';
  console.warn(`[Config] sharp unavailable${errorMessage}; report screenshot compression disabled.`);
}
const finalScreenshotMarker = '__FINAL_SCREENSHOT__'; // Sentinel to relabel the next screenshot in Mochawesome.
const finalScreenshotLabel = '!!! FINAL SCREENSHOT (TEST PASSED) !!!';
const failureScreenshotMarker = '__FAILURE_SCREENSHOT__';
const failureScreenshotLabel = '!!! FAILURE SCREENSHOT (TEST FAILED) !!!';
const screenshotLabelMap = {
  [finalScreenshotMarker]: finalScreenshotLabel,
  [failureScreenshotMarker]: failureScreenshotLabel,
};
const dataUrlPattern = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/;
const visualCheckpointTitlePattern = /^STEP \d+ VISUAL CHECKPOINT - ([0-9]+(?:\.[0-9]+)?)% DIFFERENCE$/;
const visualDiffTitlePattern = /^STEP \d+ VISUAL DIFF$/;
const visualPendingTitlePattern = /^STEP \d+ BASELINE CREATED - COMPARISON PENDING$/;

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
  if (!sharp) {
    return null;
  }

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

const shouldKeepReportContextEntry = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return true;
  }

  if (entry.title === 'Session Id') {
    return false;
  }

  if (entry.title === finalScreenshotMarker || entry.title === failureScreenshotMarker) {
    return false;
  }

  return true;
};

const parseContextEntries = (item) => {
  if (!item || typeof item.context !== 'string') {
    return null;
  }

  try {
    return JSON.parse(item.context);
  } catch (error) {
    return null;
  }
};

const contextHasVisualRegression = (context) => {
  if (!Array.isArray(context)) {
    return false;
  }

  return context.some((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.title !== 'string') {
      return false;
    }

    if (visualDiffTitlePattern.test(entry.title)) {
      return true;
    }

    const match = visualCheckpointTitlePattern.exec(entry.title);
    return Boolean(match && Number.parseFloat(match[1]) > 0);
  });
};

const contextHasPendingVisualComparison = (context) => {
  if (!Array.isArray(context)) {
    return false;
  }

  return context.some((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.title !== 'string') {
      return false;
    }

    return visualPendingTitlePattern.test(entry.title);
  });
};

const normalizeTestStateForVisualRegression = (test) => {
  const context = parseContextEntries(test);

  if (!contextHasVisualRegression(context)) {
    return false;
  }

  test.state = 'failed';
  test.pass = false;
  test.fail = true;
  test.pending = false;
  test.skipped = false;
  test.err = {
    ...(test.err || {}),
    name: test.err?.name || 'VisualDifferenceError',
    message: test.err?.message || 'Visual difference detected',
    stack: test.err?.stack || 'Visual difference detected',
    estack: test.err?.estack || 'Visual difference detected',
  };

  return true;
};

const normalizeTestStateForPendingVisualComparison = (test) => {
  if (!test || test.fail === true || test.state === 'failed') {
    return false;
  }

  const context = parseContextEntries(test);

  if (contextHasVisualRegression(context) || !contextHasPendingVisualComparison(context)) {
    return false;
  }

  test.state = 'pending';
  test.pass = false;
  test.fail = false;
  test.pending = true;
  test.skipped = true;
  test.err = {};

  return true;
};

const rebuildSuiteStateLists = (suite) => {
  if (!suite || typeof suite !== 'object') {
    return;
  }

  suite.passes = [];
  suite.failures = [];
  suite.pending = [];
  suite.skipped = [];

  if (Array.isArray(suite.tests)) {
    for (const test of suite.tests) {
      if (test?.pass) {
        suite.passes.push(test.uuid);
      } else if (test?.fail) {
        suite.failures.push(test.uuid);
      } else if (test?.pending || test?.skipped) {
        suite.pending.push(test.uuid);
        suite.skipped.push(test.uuid);
      }
    }
  }

  if (Array.isArray(suite.suites)) {
    suite.suites.forEach(rebuildSuiteStateLists);
  }
};

const collectStatsFromSuite = (suite) => {
  const counts = {
    tests: 0,
    passes: 0,
    failures: 0,
    pending: 0,
    skipped: 0,
  };

  if (!suite || typeof suite !== 'object') {
    return counts;
  }

  if (Array.isArray(suite.tests)) {
    for (const test of suite.tests) {
      counts.tests += 1;
      if (test?.pass) {
        counts.passes += 1;
      } else if (test?.fail) {
        counts.failures += 1;
      } else if (test?.pending || test?.skipped) {
        counts.pending += 1;
        counts.skipped += 1;
      }
    }
  }

  if (Array.isArray(suite.suites)) {
    for (const child of suite.suites) {
      const childCounts = collectStatsFromSuite(child);
      counts.tests += childCounts.tests;
      counts.passes += childCounts.passes;
      counts.failures += childCounts.failures;
      counts.pending += childCounts.pending;
      counts.skipped += childCounts.skipped;
    }
  }

  return counts;
};

const normalizeVisualRegressionResultsFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return { changed: false, hasFailures: false };
  }

  let data;

  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`[Mochawesome] Failed to read JSON for regression normalization: ${error.message}`);
    return { changed: false, hasFailures: false };
  }

  let changed = false;
  let hasFailures = false;

  const results = Array.isArray(data.results) ? data.results : [];
  for (const result of results) {
    const suites = Array.isArray(result.suites) ? result.suites : [];

    for (const suite of suites) {
      const stack = [suite];

      while (stack.length > 0) {
        const current = stack.pop();

        if (Array.isArray(current?.tests)) {
          for (const test of current.tests) {
            const failedChanged = normalizeTestStateForVisualRegression(test);
            const pendingChanged = normalizeTestStateForPendingVisualComparison(test);
            changed = changed || failedChanged || pendingChanged;
            hasFailures = hasFailures || test?.fail === true;
          }
        }

        if (Array.isArray(current?.suites)) {
          current.suites.forEach((child) => stack.push(child));
        }
      }

      rebuildSuiteStateLists(suite);
    }
  }

  const totals = results.reduce(
    (acc, result) => {
      const suites = Array.isArray(result.suites) ? result.suites : [];
      for (const suite of suites) {
        const suiteCounts = collectStatsFromSuite(suite);
        acc.tests += suiteCounts.tests;
        acc.passes += suiteCounts.passes;
        acc.failures += suiteCounts.failures;
        acc.pending += suiteCounts.pending;
        acc.skipped += suiteCounts.skipped;
      }
      return acc;
    },
    { tests: 0, passes: 0, failures: 0, pending: 0, skipped: 0 },
  );

  if (data.stats) {
    data.stats.tests = totals.tests;
    data.stats.testsRegistered = totals.tests;
    data.stats.passes = totals.passes;
    data.stats.failures = totals.failures;
    data.stats.pending = totals.pending;
    data.stats.skipped = totals.skipped;
    data.stats.hasSkipped = totals.skipped > 0;
    data.stats.passPercent = totals.tests === 0 ? 0 : Math.round((totals.passes / totals.tests) * 100);
    data.stats.pendingPercent = totals.tests === 0 ? 0 : Math.round((totals.pending / totals.tests) * 100);
    data.stats.other = 0;
    data.stats.hasOther = false;
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(data));
  }

  return { changed, hasFailures };
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
      if (!shouldKeepReportContextEntry(entry)) {
        changed = true;
        continue;
      }

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

const injectReportScreenshotCss = (reportPath, displayWidth) => {
  if (!displayWidth || !fs.existsSync(reportPath)) {
    return;
  }

  const html = fs.readFileSync(reportPath, 'utf8');

  if (html.includes('data-wdio-report-screenshot-size')) {
    return;
  }

  const marker = '</head>';

  if (!html.includes(marker)) {
    console.warn('[Mochawesome] Unable to inject screenshot sizing; </head> not found.');
    return;
  }

  const styleTag = [
    '<style data-wdio-report-screenshot-size>',
    `#report img[src^="data:image"]{width:${displayWidth}px;max-width:100%;height:auto;}`,
    '</style>',
  ].join('');

  const updated = html.replace(marker, `${styleTag}${marker}`);
  fs.writeFileSync(reportPath, updated);
};

const browserStackUser = process.env.BROWSERSTACK_USERNAME || process.env.BROWSERSTACK_USER;
const browserStackKey = process.env.BROWSERSTACK_ACCESS_KEY || process.env.BROWSERSTACK_KEY;
const runOnBrowserStack = Boolean(browserStackUser && browserStackKey);
const platformName = (process.env.PLATFORM_NAME || 'Android').toLowerCase();
const isAndroid = platformName === 'android';
const appiumServiceLogLevel = normalizeAppiumServiceLogLevel(appiumLogLevel);
const appiumStartTimeout = normalizePositiveInt(
  process.env.APPIUM_START_TIMEOUT,
  isCI ? 60000 : isAndroid ? 30000 : 120000,
);
const ensureXcodeDeveloperDir = () => {
  if (isAndroid || runOnBrowserStack || process.platform !== 'darwin') {
    return;
  }

  if (process.env.DEVELOPER_DIR) {
    return;
  }

  const xcodeDeveloperDir = '/Applications/Xcode.app/Contents/Developer';

  if (!fs.existsSync(xcodeDeveloperDir)) {
    return;
  }

  try {
    const selected = execSync('xcode-select -p', { encoding: 'utf8' }).trim();
    if (selected.includes('CommandLineTools')) {
      process.env.DEVELOPER_DIR = xcodeDeveloperDir;
    }
  } catch (error) {
    process.env.DEVELOPER_DIR = xcodeDeveloperDir;
  }
};
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
ensureXcodeDeveloperDir();
const resolveIosSimulatorDefaults = () => {
  if (isAndroid || runOnBrowserStack || process.platform !== 'darwin') {
    return null;
  }

  if (process.env.DEVICE_NAME || process.env.PLATFORM_VERSION || process.env.UDID) {
    return null;
  }

  const runtimesRaw = execSync('xcrun simctl list runtimes -j', { encoding: 'utf8' });
  const bootedRaw = execSync('xcrun simctl list devices booted -j', { encoding: 'utf8' });
  const runtimes = JSON.parse(runtimesRaw).runtimes || [];
  const booted = JSON.parse(bootedRaw).devices || {};

  const runtimeVersions = new Map();
  runtimes.forEach((runtime) => {
    if (!runtime || !runtime.isAvailable || typeof runtime.name !== 'string') {
      return;
    }
    const match = /iOS ([0-9.]+)/.exec(runtime.name);
    if (match && runtime.identifier) {
      runtimeVersions.set(runtime.identifier, match[1]);
    }
  });

  const candidates = [];
  Object.entries(booted).forEach(([runtimeId, devices]) => {
    if (!runtimeVersions.has(runtimeId)) {
      return;
    }
    (devices || []).forEach((device) => {
      if (!device?.udid || !device.name) {
        return;
      }
      candidates.push({ device, runtimeId });
    });
  });

  if (!candidates.length) {
    throw new Error('No booted iOS simulator found. Open Simulator or set DEVICE_NAME/PLATFORM_VERSION/UDID.');
  }

  const pick =
    candidates.find((entry) => entry.device.name.startsWith('iPhone')) || candidates[0];
  const platformVersion = runtimeVersions.get(pick.runtimeId);

  if (!platformVersion) {
    throw new Error('Unable to resolve iOS platform version for the booted simulator.');
  }

  return {
    deviceName: pick.device.name,
    platformVersion,
    udid: pick.device.udid,
  };
};
const iosSimDefaults = resolveIosSimulatorDefaults();
const findLocalApp = () => {
  const appsDir = join(process.cwd(), 'apps');

  if (!fs.existsSync(appsDir)) {
    return null;
  }

  const apkCandidates = [];
  const ipaCandidates = [];
  const appBundleCandidates = [];
  const stack = [appsDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const lower = entry.name.toLowerCase();

      if (entry.isDirectory()) {
        if (lower.endsWith('.app')) {
          appBundleCandidates.push(fullPath);
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (lower.endsWith('.apk')) {
        apkCandidates.push(fullPath);
      } else if (lower.endsWith('.ipa')) {
        ipaCandidates.push(fullPath);
      }
    }
  }

  const sortPaths = (list) => list.sort((a, b) => a.localeCompare(b));
  sortPaths(apkCandidates);
  sortPaths(appBundleCandidates);
  sortPaths(ipaCandidates);

  if (isAndroid) {
    return apkCandidates[0] || null;
  }

  return appBundleCandidates[0] || ipaCandidates[0] || null;
};
const appId = (() => {
  if (runOnBrowserStack) {
    return process.env.APP || 'bs://ce24671772a8ec2e579c84116a9ca58bf7ecde93';
  }

  const localApp = process.env.APP || findLocalApp();

  if (!localApp) {
    throw new Error(
      'APP is required for local runs (path to .apk/.app/.ipa). Example: APP=./apps/tu.apk npm run test:ci:login',
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
let visualStepIndex = 0;
let currentTestVisualTag = 'test';
let currentTestFullTitle = 'test';
let actionCaptureDepth = 0;
let currentTestPendingVisualComparisons = [];
let currentTestVisualDifferences = [];

const withTimeout = async (promise, ms, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

const sanitizeVisualTagPart = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const buildActionLabel = (element, actionName) => {
  const selector = typeof element?.selector === 'string' ? element.selector : '';
  return selector ? `Before ${actionName} (${selector})` : `Before ${actionName}`;
};

const formatDiffPercent = (diff) => `${(Number(diff || 0) * 100).toFixed(2)}%`;

const createVisualStepInfo = (element, actionName) => {
  const selector = typeof element?.selector === 'string' ? element.selector : '';
  const selectorPart = sanitizeVisualTagPart(selector) || 'screen';
  const actionPart = sanitizeVisualTagPart(actionName) || 'action';
  const index = ++visualStepIndex;
  const stepPart = String(index).padStart(2, '0');

  return {
    index,
    stepPart,
    reportTitle: `STEP ${stepPart}`,
    description: buildActionLabel(element, actionName),
    tag: `${currentTestVisualTag}-${stepPart}-${actionPart}-${selectorPart}`,
  };
};

const createFinalVisualStepInfo = () => {
  const index = ++visualStepIndex;
  const stepPart = String(index).padStart(2, '0');

  return {
    index,
    stepPart,
    reportTitle: `STEP ${stepPart}`,
    description: 'Final screen',
    tag: `${currentTestVisualTag}-${stepPart}-final-screen`,
  };
};

const resetCurrentTestVisualState = () => {
  visualStepIndex = 0;
  actionCaptureDepth = 0;
  currentTestPendingVisualComparisons = [];
  currentTestVisualDifferences = [];
};

const readPendingVisualFailures = () => {
  if (!fs.existsSync(pendingVisualResultsFile)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(pendingVisualResultsFile, 'utf8'));
  } catch (error) {
    return {};
  }
};

const writePendingVisualFailure = (fullTitle, pendingSteps) => {
  if (!fullTitle || !pendingSteps) {
    return;
  }

  const current = readPendingVisualFailures();
  current[fullTitle] = pendingSteps;
  fs.writeFileSync(pendingVisualResultsFile, JSON.stringify(current));
};

const recordVisualDifference = (stepInfo, diff) => {
  currentTestVisualDifferences.push({
    reportTitle: stepInfo.reportTitle,
    diffPercent: formatDiffPercent(diff),
  });
};

const createPendingVisualFailureMessage = (pendingSteps) =>
  `Visual baseline missing - comparison pending in ${pendingSteps.join(
    ', ',
  )}. Re-run the test to validate generated baselines.`;

const createVisualDifferenceFailureMessage = (differences) =>
  `Visual differences detected in ${differences
    .map((entry) => `${entry.reportTitle} (${entry.diffPercent})`)
    .join(', ')}.`;

const markPendingVisualComparison = (stepInfo) => {
  if (!stepInfo?.reportTitle) {
    return;
  }

  if (!currentTestPendingVisualComparisons.includes(stepInfo.reportTitle)) {
    currentTestPendingVisualComparisons.push(stepInfo.reportTitle);
  }
};

const screenshotDataUrlFromBase64 = (base64) => {
  if (!base64) {
    return null;
  }

  return `data:image/png;base64,${base64}`;
};

const readImageFileAsDataUrl = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const extension = filePath.split('.').pop()?.toLowerCase();
  const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/png';
  const buffer = fs.readFileSync(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
};

const findVisualArtifactPath = (artifactType, tag) => {
  const artifactDir = join(reportDirs.visualOutput, artifactType);

  if (!fs.existsSync(artifactDir)) {
    return null;
  }

  const prefix = `${tag}-`;
  const match = listFilesRecursive(artifactDir)
    .sort()
    .find((filePath) => fs.statSync(filePath).isFile() && filePath.split(sep).pop()?.startsWith(prefix));

  return match || null;
};

const findBaselineArtifactPath = (tag) => {
  if (!fs.existsSync(reportDirs.visualBaseline)) {
    return null;
  }

  const prefix = `${tag}-`;
  const match = listFilesRecursive(reportDirs.visualBaseline)
    .sort()
    .find((filePath) => fs.statSync(filePath).isFile() && filePath.split(sep).pop()?.startsWith(prefix));

  return match || null;
};

const emitReportContext = (title, value) => {
  process.emit('wdio-mochawesome-reporter:addContext', { title, value });
};

const emitVisualStepReport = ({
  stepInfo,
  diff,
  screenshotBase64,
  diffArtifactPath,
  baselineCreated = false,
}) => {
  emitReportContext(stepInfo.reportTitle, stepInfo.description);

  const stepCapture = screenshotDataUrlFromBase64(screenshotBase64);
  if (stepCapture) {
    emitReportContext(`${stepInfo.reportTitle} CAPTURE`, stepCapture);
  }

  // `enableVisualComparison` is defined from VISUAL_COMPARE env near the config constants section.
  if (!enableVisualComparison) {
    return;
  }

  if (baselineCreated) {
    markPendingVisualComparison(stepInfo);
    emitReportContext(
      `${stepInfo.reportTitle} BASELINE CREATED - COMPARISON PENDING`,
      'Baseline created in this run. Re-run the test to validate this step.',
    );
    return;
  }

  emitReportContext(
    `${stepInfo.reportTitle} VISUAL CHECKPOINT - ${formatDiffPercent(diff)} DIFFERENCE`,
    stepInfo.description,
  );

  if (diff > 0 && diffArtifactPath) {
    const diffImage = readImageFileAsDataUrl(diffArtifactPath);
    if (diffImage) {
      emitReportContext(`${stepInfo.reportTitle} VISUAL DIFF`, diffImage);
    }
  }
};

const captureActionScreenshot = async (element, actionName) => {
  if (!isInTest) {
    return;
  }

  const isVisualMode = enableVisualComparison && typeof browser.checkScreen === 'function';

  let exists = false;

  try {
    exists = await element.isExisting();
  } catch (error) {
    return;
  }

  if (!exists) {
    return;
  }

  const stepInfo = createVisualStepInfo(element, actionName);
  let diff = 0;
  const baselineExisted = isVisualMode ? Boolean(findBaselineArtifactPath(stepInfo.tag)) : false;

  if (isVisualMode) {
    diff = await browser.checkScreen(stepInfo.tag, { hideElements: [] });
  }

  let screenshotBase64 = null;

  try {
    screenshotBase64 = await browser.takeScreenshot();
  } catch (error) {
    console.warn(`[Screenshot] Failed before ${actionName}: ${error.message}`);
  }

  const diffArtifactPath = diff > 0 ? findVisualArtifactPath('diff', stepInfo.tag) : null;
  emitVisualStepReport({
    stepInfo,
    diff,
    screenshotBase64,
    diffArtifactPath,
    baselineCreated: isVisualMode && !baselineExisted,
  });

  if (diff > 0) {
    if (collectAllVisualDifferences) {
      recordVisualDifference(stepInfo, diff);
      return;
    }

    throw new Error(`Visual difference detected at ${stepInfo.tag} (diff: ${diff})`);
  }
};

const runFinalVisualCheckpoint = async (testTitle) => {
  const finalStepInfo = createFinalVisualStepInfo();
  const isVisualMode = enableVisualComparison && typeof browser.checkScreen === 'function';
  const finalBaselineExisted =
    isVisualMode ? Boolean(findBaselineArtifactPath(finalStepInfo.tag)) : false;
  let finalVisualDiff = 0;
  let finalScreenshotBase64 = null;
  const mochawesomeShotsDir = reportDirs.mochawesomeScreenshots;
  const fileName = `${Date.now()}-${String(testTitle || 'test').replace(/[^a-z0-9-_]+/gi, '_')}-final.png`;
  const mochawesomeShotPath = join(mochawesomeShotsDir, fileName);
  fs.mkdirSync(mochawesomeShotsDir, { recursive: true });

  if (isVisualMode) {
    finalVisualDiff = await browser.checkScreen(finalStepInfo.tag, { hideElements: [] });
  }

  try {
    finalScreenshotBase64 = await browser.takeScreenshot();
    await browser.saveScreenshot(mochawesomeShotPath);
  } catch (error) {
    console.warn(`[Screenshot] Failed final capture for ${testTitle}: ${error.message}`);
  }

  if (!isVisualMode) {
    emitReportContext(finalStepInfo.reportTitle, finalStepInfo.description);
    const stepCapture = screenshotDataUrlFromBase64(finalScreenshotBase64);
    if (stepCapture) {
      emitReportContext(`${finalStepInfo.reportTitle} CAPTURE`, stepCapture);
    }
    return;
  }

  emitVisualStepReport({
    stepInfo: finalStepInfo,
    diff: finalVisualDiff || 0,
    screenshotBase64: finalScreenshotBase64,
    diffArtifactPath: finalVisualDiff > 0 ? findVisualArtifactPath('diff', finalStepInfo.tag) : null,
    baselineCreated: !finalBaselineExisted,
  });

  if (finalVisualDiff > 0) {
    if (collectAllVisualDifferences) {
      recordVisualDifference(finalStepInfo, finalVisualDiff);
      return;
    }

    throw new Error(`Visual difference detected at ${finalStepInfo.tag} (diff: ${finalVisualDiff})`);
  }
};

const installActionScreenshotHooks = () => {
  if (actionScreenshotHooksInstalled) {
    return;
  }

  actionScreenshotHooksInstalled = true;
  const commandsToCapture = ['click', 'setValue'];

  commandsToCapture.forEach((commandName) => {
    browser.overwriteCommand(
      commandName,
      async function (origCommand, ...args) {
        if (actionCaptureDepth > 0) {
          return origCommand.apply(this, args);
        }

        actionCaptureDepth += 1;

        try {
          await captureActionScreenshot(this, commandName);
          return origCommand.apply(this, args);
        } finally {
          actionCaptureDepth -= 1;
        }
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
    appiumStartTimeout,
    args: {
      basePath: '/wd/hub',
      logLevel: appiumServiceLogLevel,
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
  'appium:deviceName':
    process.env.DEVICE_NAME || (isAndroid ? 'Android Emulator' : iosSimDefaults?.deviceName || 'iPhone Simulator'),
  'appium:platformVersion':
    process.env.PLATFORM_VERSION || (isAndroid ? '14.0' : iosSimDefaults?.platformVersion || '17.0'),
  'appium:udid': process.env.UDID || (isAndroid ? 'emulator-5554' : iosSimDefaults?.udid || 'auto'),
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
  logLevels: {
    webdriver: webdriverLogLevel,
  },
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
    includeScreenshots: false,
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
  onPrepare: async () => {
    if (fs.existsSync(pendingVisualResultsFile)) {
      fs.rmSync(pendingVisualResultsFile, { force: true });
    }
  },

  beforeTest: async (test) => {
    resetCurrentTestVisualState();
    isInTest = true;
    currentTestVisualTag = sanitizeVisualTagPart(test?.fullTitle || test?.title || 'test') || 'test';
    currentTestFullTitle = test?.fullTitle || test?.title || 'test';
    await driver.setTimeout({ implicit: 10000 });
  },

  afterTest: async function (test, context, { error, passed }) {
    suiteHasFailures = suiteHasFailures || Boolean(error);
    const sanitizedTitle = test.title.replace(/[^a-z0-9-_]+/gi, '_');

    if (!passed) {
      const timestamp = Date.now();
      const fileName = `${timestamp}-${sanitizedTitle}.png`;
      const visualErrorDir = join(reportDirs.visualOutput, 'errorShots');
      const mochawesomeShotsDir = reportDirs.mochawesomeScreenshots;
      const mochawesomeShotPath = join(mochawesomeShotsDir, fileName);
      const visualShotPath = join(visualErrorDir, fileName);
      fs.mkdirSync(mochawesomeShotsDir, { recursive: true });
      fs.mkdirSync(visualErrorDir, { recursive: true });

      await browser.saveScreenshot(mochawesomeShotPath);
      fs.copyFileSync(mochawesomeShotPath, visualShotPath);

      try {
        const source = await browser.getPageSource();
        const sourceFileName = `${timestamp}-${sanitizedTitle}.xml`;
        const sourcePath = join(reportDirs.pageSource, sourceFileName);
        fs.writeFileSync(sourcePath, source);
      } catch (sourceError) {
      }
    } else {
      await runFinalVisualCheckpoint(test.fullTitle || test.title);

      const isVisualMode = enableVisualComparison && typeof browser.checkScreen === 'function';

      if (isVisualMode && currentTestPendingVisualComparisons.length > 0) {
        const pendingMessage = createPendingVisualFailureMessage(currentTestPendingVisualComparisons);
        visualFailureMessagesByTest.set(currentTestFullTitle, pendingMessage);
        writePendingVisualFailure(currentTestFullTitle, { type: 'pending', message: pendingMessage });
      } else if (isVisualMode && currentTestVisualDifferences.length > 0) {
        const differenceMessage = createVisualDifferenceFailureMessage(currentTestVisualDifferences);
        visualFailureMessagesByTest.set(currentTestFullTitle, differenceMessage);
        writePendingVisualFailure(currentTestFullTitle, { type: 'diff', message: differenceMessage });
      }
    }

    isInTest = false;
    resetCurrentTestVisualState();
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

    for (const file of resultFiles) {
      const normalized = normalizeVisualRegressionResultsFile(join(resultsDir, file));
      suiteHasFailures = suiteHasFailures || normalized.hasFailures;
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

    const normalizedMerged = normalizeVisualRegressionResultsFile(mergedFile);
    suiteHasFailures = suiteHasFailures || normalizedMerged.hasFailures;
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
    const reportPath = join(reportDir, `${reportFileName}.html`);
    execSync(
      `npx marge --inline ${mergedFile} -o ${reportDir} -f ${reportFileName} -t "${reportTitle}" -p "${reportPageTitle}"`,
      { stdio: 'inherit' },
    );
    injectReportScreenshotCss(reportPath, reportScreenshotDisplayWidth);

    if (suiteHasFailures) {
      throw new Error('Visual differences detected');
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
