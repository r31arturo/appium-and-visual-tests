const fs = require('node:fs');
const { join, sep, relative, extname, dirname, basename, isAbsolute } = require('node:path');
const { execSync } = require('node:child_process');
const mergeResults = require('wdio-mochawesome-reporter/mergeResults');
const { handleBaselineMissing, isBaselineMissingError } = require('./tests/utils/visual-baseline');
const { applyDiffHighlight, computeDiffBoundingBox } = require('./tests/utils/visual-diff');
let sharp = null;
let sharpLoadError = null;
let pixelmatch = null;
let pixelmatchLoadError = null;

const stripTsxNodeOptions = (value) => {
  if (!value) {
    return value;
  }

  const tokens = value.split(/\s+/).filter(Boolean);
  const result = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const isLoaderToken = token === '--import' || token === '--loader';
    if (isLoaderToken) {
      const nextToken = tokens[index + 1];
      if (nextToken && nextToken.includes('tsx')) {
        index += 1;
        continue;
      }
    }

    if ((token.startsWith('--import=') || token.startsWith('--loader=')) && token.includes('tsx')) {
      continue;
    }

    result.push(token);
  }

  return result.join(' ');
};

// WDIO injects tsx into NODE_OPTIONS even for JS configs; strip it so Appium can boot cleanly in CI.
if ((process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') && process.env.NODE_OPTIONS) {
  process.env.NODE_OPTIONS = stripTsxNodeOptions(process.env.NODE_OPTIONS);
}

try {
  sharp = require('sharp');
} catch (error) {
  sharpLoadError = error;
}

try {
  pixelmatch = require('pixelmatch');
} catch (error) {
  pixelmatchLoadError = error;
}

const reportDir = join(process.cwd(), 'report');
const visualBaselinePendingDir =
  process.env.VISUAL_BASELINE_PENDING_DIR || join(reportDir, 'visual-baseline-pending');
const reportDirs = {
  visualBaseline: join(reportDir, 'visual-baseline'),
  visualBaselinePending: visualBaselinePendingDir,
  visualOutput: join(reportDir, 'visual-output'),
  visualReportBaseline: join(reportDir, 'visual-report', 'baseline'),
  visualReportCurrent: join(reportDir, 'visual-report', 'current'),
  visualReportDiff: join(reportDir, 'visual-report', 'diff'),
  junit: join(reportDir, 'junit'),
  pageSource: join(reportDir, 'page-source'),
  mochawesomeJson: join(reportDir, 'mochawesome-json'),
  mochawesomeScreenshots: join(reportDir, 'mochawesome-screenshots'),
};

fs.mkdirSync(reportDir, { recursive: true });
Object.values(reportDirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
if (!process.env.VISUAL_BASELINE_PENDING_DIR) {
  process.env.VISUAL_BASELINE_PENDING_DIR = reportDirs.visualBaselinePending;
}

const visualComparisonCounterKey = '__wdioVisualComparisons';
const visualMissingBaselineKey = '__wdioVisualMissingBaselines';
const visualMismatchKey = '__wdioVisualMismatches';
const visualStepCounterKey = '__wdioVisualStepCounter';
const visualTestLabelKey = '__wdioVisualTestLabel';
let visualComparisonCounterInstalled = false;
let visualTestWrapperInstalled = false;
const resetVisualComparisonCounter = () => {
  global[visualComparisonCounterKey] = 0;
};
const incrementVisualComparisonCounter = () => {
  global[visualComparisonCounterKey] = (global[visualComparisonCounterKey] || 0) + 1;
};
const getVisualComparisonCounter = () => global[visualComparisonCounterKey] || 0;
const resetVisualMissingBaselineCounter = () => {
  global[visualMissingBaselineKey] = 0;
};
const getVisualMissingBaselineCounter = () => global[visualMissingBaselineKey] || 0;
const resetVisualMismatchList = () => {
  global[visualMismatchKey] = [];
};
const addVisualMismatch = (entry) => {
  if (!global[visualMismatchKey]) {
    global[visualMismatchKey] = [];
  }
  global[visualMismatchKey].push(entry);
};
const getVisualMismatchList = () => global[visualMismatchKey] || [];
const sanitizeTag = (value, maxLength = 40) => {
  if (!value) {
    return '';
  }

  const safe = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!safe) {
    return '';
  }

  return safe.slice(0, maxLength);
};
const formatPercentLabel = (value) => {
  if (!Number.isFinite(value)) {
    return '0';
  }

  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};
const extractComparisonFolders = (result) => {
  if (!result || typeof result !== 'object') {
    return null;
  }

  if (result.folders && typeof result.folders === 'object') {
    return result.folders;
  }

  const firstEntry = Object.values(result)[0];
  if (firstEntry && typeof firstEntry === 'object' && firstEntry.folders) {
    return firstEntry.folders;
  }

  return null;
};
const extractMismatchPercentage = (result) => {
  const parseValue = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    if (value && typeof value === 'object') {
      const inner = value.misMatchPercentage;
      if (typeof inner === 'number' && Number.isFinite(inner)) {
        return inner;
      }
      if (typeof inner === 'string') {
        const parsed = Number.parseFloat(inner);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return null;
  };

  const direct = parseValue(result);
  if (direct !== null) {
    return direct;
  }

  if (result && typeof result === 'object') {
    const firstEntry = Object.values(result)[0];
    return parseValue(firstEntry);
  }

  return null;
};
const ensureReturnAllCompareData = (commandName, args) => {
  const optionsIndex = commandName === 'checkElement' ? 2 : 1;
  const rawOptions = args?.[optionsIndex];
  const wantsAllData = Boolean(rawOptions && typeof rawOptions === 'object' && rawOptions.returnAllCompareData);

  if (wantsAllData) {
    return { callArgs: args, wantsAllData };
  }

  const nextArgs = [...args];
  const nextOptions = rawOptions && typeof rawOptions === 'object' ? { ...rawOptions } : {};
  nextOptions.returnAllCompareData = true;
  nextArgs[optionsIndex] = nextOptions;

  return { callArgs: nextArgs, wantsAllData };
};
const resolveVisualTagFromArgs = (commandName, args) => {
  if (commandName === 'checkElement') {
    return args?.[1];
  }

  return args?.[0];
};
const resetVisualStepCounter = () => {
  global[visualStepCounterKey] = 0;
};
const nextVisualStepCounter = () => {
  global[visualStepCounterKey] = (global[visualStepCounterKey] || 0) + 1;
  return global[visualStepCounterKey];
};
const setVisualTestLabel = (test) => {
  const parent = typeof test?.parent === 'string' ? test.parent : test?.parent?.title;
  const title = test?.title || 'test';
  const raw = parent ? `${parent} ${title}` : title;
  global[visualTestLabelKey] = sanitizeTag(raw, 50);
};
const getVisualTestLabel = () => global[visualTestLabelKey] || 'test';
const toReportRelativePath = (absolutePath) => {
  if (!absolutePath) {
    return null;
  }

  const relPath = relative(reportDir, absolutePath);
  return relPath.split(sep).join('/');
};
const resolvePendingBaselinePath = (actualPath) => {
  if (!actualPath) {
    return null;
  }

  const pendingBase = reportDirs.visualBaselinePending;
  const actualBase = browser?.visualService?.folders?.actualFolder;
  const relativePath = actualBase ? relative(actualBase, actualPath) : basename(actualPath);
  const safeRelative =
    relativePath.startsWith('..') || isAbsolute(relativePath) ? basename(actualPath) : relativePath;
  return join(pendingBase, safeRelative);
};
const copyCurrentToPendingBaseline = (actualPath, tag, mismatch) => {
  if (!actualPath || !fs.existsSync(actualPath)) {
    return null;
  }

  const pendingPath = resolvePendingBaselinePath(actualPath);
  if (!pendingPath) {
    return null;
  }

  try {
    fs.mkdirSync(dirname(pendingPath), { recursive: true });
    fs.copyFileSync(actualPath, pendingPath);
    const label = tag || 'visual';
    const mismatchLabel = Number.isFinite(mismatch) ? ` (${formatPercentLabel(mismatch)}%)` : '';
    console.warn(`[Visual] Mismatch${mismatchLabel} for \"${label}\". Saved current to ${pendingPath}.`);
    return pendingPath;
  } catch (error) {
    console.warn(`[Visual] Failed to save pending baseline for mismatch: ${error.message}`);
    return null;
  }
};
const addMochawesomeContext = (title, value) => {
  if (value === undefined || value === null || value === '') {
    return;
  }

  process.emit('wdio-mochawesome-reporter:addContext', { title, value });
};
const visualReportDirsByType = {
  baseline: reportDirs.visualReportBaseline,
  current: reportDirs.visualReportCurrent,
  diff: reportDirs.visualReportDiff,
};
const buildVisualReportFileName = (label, tag, comparisonIndex, sourcePath) => {
  const safeLabel = sanitizeTag(label, 16) || 'visual';
  const safeTest = sanitizeTag(getVisualTestLabel(), 40);
  const safeTag = sanitizeTag(tag, 40);
  const counter = Number.isFinite(comparisonIndex)
    ? `c${String(comparisonIndex).padStart(3, '0')}`
    : null;
  const extension = extname(sourcePath) || '.png';
  const parts = [safeLabel, safeTest, safeTag, counter].filter(Boolean);
  const baseName = parts.length ? parts.join('__') : 'visual';
  return `${baseName}${extension}`;
};
const prepareVisualReportImage = async (sourcePath, type, tag, comparisonIndex, options = {}) => {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return null;
  }

  const wantsDiffHighlight =
    type === 'diff' &&
    Boolean(options.baselinePath && options.actualPath && sharp && pixelmatch);
  if (!shouldCompressReportScreenshots && !wantsDiffHighlight) {
    return sourcePath;
  }

  const targetDir = visualReportDirsByType[type];
  if (!targetDir) {
    return sourcePath;
  }

  const fileName = buildVisualReportFileName(type, tag, comparisonIndex, sourcePath);
  const targetPath = join(targetDir, fileName);

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    let inputBuffer = fs.readFileSync(sourcePath);
    let didHighlight = false;

    if (wantsDiffHighlight) {
      const bbox = await computeDiffBoundingBox({
        baselinePath: options.baselinePath,
        actualPath: options.actualPath,
        sharp,
        pixelmatch,
      });
      if (bbox) {
        inputBuffer = await applyDiffHighlight({ inputBuffer, bbox, sharp });
        didHighlight = true;
      }
    }
    const extension = extname(sourcePath).slice(1);
    const output = await compressImageBuffer(inputBuffer, extension, reportScreenshotSettings);

    if (output && output.buffer.length < inputBuffer.length) {
      const tempPath = `${targetPath}.tmp`;
      fs.writeFileSync(tempPath, output.buffer);
      fs.renameSync(tempPath, targetPath);
      return targetPath;
    }

    if (didHighlight) {
      fs.writeFileSync(targetPath, inputBuffer);
      return targetPath;
    }

    fs.copyFileSync(sourcePath, targetPath);
    return targetPath;
  } catch (error) {
    console.warn(`[Visual] Failed to prepare ${type} image for report: ${error.message}`);
    return sourcePath;
  }
};
const attachVisualBaselineAndCurrent = async (commandName, args, result, comparisonIndex) => {
  if (!enableVisualComparison || !isInTest) {
    return;
  }

  const folders = extractComparisonFolders(result);
  if (!folders) {
    return;
  }

  const tag = resolveVisualTagFromArgs(commandName, args);
  const suffix = tag ? ` (${tag})` : '';
  const baselineReportPath = await prepareVisualReportImage(
    folders.baseline,
    'baseline',
    tag,
    comparisonIndex,
  );
  const actualReportPath = await prepareVisualReportImage(folders.actual, 'current', tag, comparisonIndex);
  const baselinePath = toReportRelativePath(baselineReportPath || folders.baseline);
  const actualPath = toReportRelativePath(actualReportPath || folders.actual);

  if (baselinePath) {
    addMochawesomeContext(`Visual baseline${suffix}`, baselinePath);
  }
  // Skip explicit "Visual current" to avoid duplicate entries; "Current Screenshot" already covers it.
};
const buildVisualIssues = () => {
  const issues = [];
  const missingBaselines = getVisualMissingBaselineCounter();
  if (missingBaselines > 0) {
    issues.push(
      `[Visual] Missing ${missingBaselines} baseline(s). Move files from report/visual-baseline-pending into report/visual-baseline and re-run.`,
    );
  }

  const mismatches = getVisualMismatchList();
  if (mismatches.length > 0) {
    const header = `[Visual] ${mismatches.length} mismatch(es) above ${formatPercentLabel(
      visualMismatchTolerancePercent,
    )}%:`;
    const lines = mismatches
      .map((entry, index) => {
        const tagLabel = entry.tag || entry.commandName || `mismatch_${index + 1}`;
        const diffLabel = entry.diffPathRelative || entry.diffPath;
        const diffText = diffLabel ? ` (diff: ${diffLabel})` : '';
        return `- ${tagLabel}: ${formatPercentLabel(entry.mismatch)}%${diffText}`;
      })
      .join('\n');
    issues.push([header, lines].filter(Boolean).join('\n'));
  }

  if (getVisualComparisonCounter() === 0) {
    issues.push(
      '[Visual] No visual comparisons executed in this test. Use checkScreen/checkElement or the baseline helper.',
    );
  }

  return issues;
};
const wrapTestWithVisualAssertions = (test) => {
  if (!enableVisualComparison || !test || typeof test.fn !== 'function') {
    return;
  }

  if (test.__wdioVisualWrapped) {
    return;
  }

  test.__wdioVisualWrapped = true;
  const original = test.fn;

  const runVisualFinalCheck = async () => {
    const priorIsInTest = isInTest;
    isInTest = true;
    try {
      if (typeof browser?.checkScreen === 'function') {
        const finalTag = buildFinalVisualTag();
        await browser.checkScreen(finalTag, { hideElements: [] });
      }

      const issues = buildVisualIssues();
      if (issues.length > 0) {
        suiteHasFailures = true;
        throw new Error(issues.join('\n'));
      }
    } finally {
      isInTest = priorIsInTest;
    }
  };

  test.fn = function (...args) {
    const context = this;
    const expectsDone = original.length > 0 && typeof args[0] === 'function';

    if (expectsDone) {
      const done = args[0];
      const wrappedDone = (err) => {
        if (err) {
          done(err);
          return;
        }

        Promise.resolve()
          .then(runVisualFinalCheck)
          .then(() => done())
          .catch((error) => done(error));
      };

      return original.call(context, wrappedDone);
    }

    return Promise.resolve()
      .then(() => original.apply(context, args))
      .then(async (result) => {
        await runVisualFinalCheck();
        return result;
      });
  };

  test.fn.toString = () => original.toString();
};
const installVisualTestWrapper = () => {
  if (visualTestWrapperInstalled || typeof global.beforeEach !== 'function') {
    return;
  }

  visualTestWrapperInstalled = true;
  global.beforeEach(function () {
    if (!enableVisualComparison) {
      return;
    }

    wrapTestWithVisualAssertions(this?.currentTest);
  });
};
const installVisualComparisonCounter = () => {
  if (visualComparisonCounterInstalled) {
    return;
  }

  const commandNames = ['checkScreen', 'checkElement', 'checkFullPageScreen', 'checkTabbablePage'];
  const hasCommands = commandNames.some((commandName) => typeof browser?.[commandName] === 'function');
  if (!hasCommands) {
    return;
  }

  visualComparisonCounterInstalled = true;
  const wrap = (commandName) => {
    if (typeof browser?.[commandName] !== 'function') {
      return;
    }
    const original = browser[commandName].bind(browser);
    browser[commandName] = async (...args) => {
      incrementVisualComparisonCounter();
      try {
        const { callArgs, wantsAllData } = ensureReturnAllCompareData(commandName, args);
        const result = await original(...callArgs);
        const comparisonIndex = getVisualComparisonCounter();
        if (enableVisualComparison) {
          await attachVisualBaselineAndCurrent(commandName, args, result, comparisonIndex);
        }
        const mismatch = enableVisualComparison ? extractMismatchPercentage(result) : null;
        if (enableVisualComparison && mismatch !== null && mismatch > visualMismatchTolerancePercent) {
            const tag = resolveVisualTagFromArgs(commandName, args);
            const folders = extractComparisonFolders(result);
            const diffPath = folders?.diff;
            const diffReportPath = await prepareVisualReportImage(diffPath, 'diff', tag, comparisonIndex, {
              baselinePath: folders?.baseline,
              actualPath: folders?.actual,
            });
            const diffPathRelative = toReportRelativePath(diffReportPath || diffPath);
            addVisualMismatch({
              commandName,
              tag,
              mismatch,
              diffPath,
              diffPathRelative,
            });

            if (isInTest) {
              addMochawesomeContext(
                'Visual mismatch',
                `${tag || commandName} (${formatPercentLabel(mismatch)}% > ${formatPercentLabel(
                  visualMismatchTolerancePercent,
                )}%)`,
              );
              if (diffPathRelative) {
                addMochawesomeContext('Visual diff', diffPathRelative);
              }
            }

            if (folders?.actual) {
              copyCurrentToPendingBaseline(folders.actual, tag || commandName, mismatch);
            }
        }
        return wantsAllData ? result : mismatch ?? result;
      } catch (error) {
        if (enableVisualComparison && isBaselineMissingError(error)) {
          await handleBaselineMissing({ error, commandName, args });
          return 0;
        }
        throw error;
      }
    };
  };

  commandNames.forEach(wrap);
};

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
const normalizeVisualMismatchTolerance = (value, fallback) => {
  const raw = typeof value === 'string' ? value.trim() : value;

  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  const normalized = parsed > 1 ? parsed / 100 : parsed;
  return Math.min(Math.max(normalized, 0), 1);
};
// Adjust the default visual mismatch tolerance here (1% by default).
const visualMismatchTolerance = normalizeVisualMismatchTolerance(
  process.env.VISUAL_MISMATCH_TOLERANCE,
  0.01,
);
const visualMismatchTolerancePercent = Math.round(visualMismatchTolerance * 10000) / 100;
// REPORT_SCREENSHOT_DOWNSCALE (0-1 or 0-100) controls report-only downgrade (Mochawesome + visual report copies).
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
const currentScreenshotLabel = 'Current Screenshot';
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

    if (
      enableVisualComparison &&
      entry &&
      typeof entry === 'object' &&
      entry.title === 'Screenshot'
    ) {
      updated.push({ ...entry, title: currentScreenshotLabel });
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

const buildVisualStepTag = (actionName, element) => {
  const step = String(nextVisualStepCounter()).padStart(3, '0');
  const action = sanitizeTag(`before_${actionName}`, 24);
  const selector = sanitizeTag(element?.selector, 32);
  const parts = [getVisualTestLabel(), `step_${step}`, action, selector].filter(Boolean);
  return parts.join('__');
};
const buildFinalVisualTag = () => {
  const parts = [getVisualTestLabel(), 'final'].filter(Boolean);
  return parts.join('__');
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

  let didVisualCheck = false;

  if (enableVisualComparison && typeof browser?.checkScreen === 'function') {
    const tag = buildVisualStepTag(actionName, element);
    await browser.checkScreen(tag, { hideElements: [] });
    didVisualCheck = true;
  }

  if (!didVisualCheck) {
    try {
      await browser.takeScreenshot();
    } catch (error) {
      console.warn(`[Screenshot] Failed before ${actionName}: ${error.message}`);
    }
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

  if (isCI) {
    appiumServiceOptions.command = join(process.cwd(), 'scripts', 'appium-wrapper.sh');
  }

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
      autoSaveBaseline: false,
      alwaysSaveActualImage: true,
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
    if (enableVisualComparison) {
      installVisualComparisonCounter();
      installVisualTestWrapper();
    }
  },

  beforeTest: async (test) => {
    isInTest = true;
    if (enableVisualComparison) {
      installVisualComparisonCounter();
      resetVisualComparisonCounter();
      resetVisualMissingBaselineCounter();
      resetVisualMismatchList();
      resetVisualStepCounter();
      setVisualTestLabel(test);
    }
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

      process.emit('wdio-mochawesome-reporter:addContext', {
        title: failureScreenshotMarker,
        value: true,
      });
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
    const reportPath = join(reportDir, `${reportFileName}.html`);
    execSync(
      `npx marge --inline ${mergedFile} -o ${reportDir} -f ${reportFileName} -t "${reportTitle}" -p "${reportPageTitle}"`,
      { stdio: 'inherit' },
    );
    injectReportScreenshotCss(reportPath, reportScreenshotDisplayWidth);
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
