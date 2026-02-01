const fs = require('node:fs');
const path = require('node:path');

const BASELINE_MISSING_MARKER = 'Baseline image not found';
const missingBaselinesKey = '__wdioVisualMissingBaselines';

const getPendingBaselineDir = () =>
  process.env.VISUAL_BASELINE_PENDING_DIR || path.join(process.cwd(), 'report', 'visual-baseline-pending');

const isBaselineMissingError = (error) => Boolean(error?.message?.includes(BASELINE_MISSING_MARKER));

const extractActualPath = (error) => {
  const message = error?.message;
  if (!message) {
    return null;
  }

  const match = message.match(/The image can be found here:\n([^\n]+)/);
  return match ? match[1].trim() : null;
};

const normalizeOutputToPath = (output) => {
  if (!output) {
    return null;
  }

  if (output.fileName && output.path) {
    return path.join(output.path, output.fileName);
  }

  const entries = Object.values(output);
  for (const entry of entries) {
    if (entry?.fileName && entry?.path) {
      return path.join(entry.path, entry.fileName);
    }
  }

  return null;
};

const copyActualToPending = (actualPath, pendingBase, actualBase) => {
  if (!actualPath || !pendingBase) {
    return null;
  }

  const relative = actualBase ? path.relative(actualBase, actualPath) : path.basename(actualPath);
  const safeRelative = relative.startsWith('..') || path.isAbsolute(relative)
    ? path.basename(actualPath)
    : relative;
  const pendingPath = path.join(pendingBase, safeRelative);

  try {
    fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
    fs.copyFileSync(actualPath, pendingPath);
    return pendingPath;
  } catch (error) {
    console.warn(`[Visual] Failed to copy pending baseline: ${error.message}`);
    return null;
  }
};

const saveCommandMap = {
  checkScreen: 'saveScreen',
  checkElement: 'saveElement',
  checkFullPageScreen: 'saveFullPageScreen',
  checkTabbablePage: 'saveTabbablePage',
};

const savePendingBaseline = async (commandName, element, tag, options, pendingBase) => {
  const saveCommand = saveCommandMap[commandName] || 'saveScreen';
  const saveFn = browser?.[saveCommand];
  if (typeof saveFn !== 'function') {
    return null;
  }

  const saveOptions = { ...(options || {}), actualFolder: pendingBase };
  const output =
    saveCommand === 'saveElement'
      ? await saveFn.call(browser, element, tag, saveOptions)
      : await saveFn.call(browser, tag, saveOptions);
  return normalizeOutputToPath(output);
};

const markMissingBaseline = () => {
  if (typeof global === 'undefined') {
    return;
  }

  global[missingBaselinesKey] = (global[missingBaselinesKey] || 0) + 1;
};

const resolveCommandArgs = (commandName, args) => {
  if (commandName === 'checkElement') {
    return {
      element: args?.[0] ?? null,
      tag: args?.[1],
      options: args?.[2] ?? {},
    };
  }

  return {
    element: null,
    tag: args?.[0],
    options: args?.[1] ?? {},
  };
};

const handleBaselineMissing = async ({ error, commandName = 'checkScreen', args, tag, options, element }) => {
  const pendingBase = getPendingBaselineDir();
  fs.mkdirSync(pendingBase, { recursive: true });

  const resolved = tag ? { tag, options: options || {}, element } : resolveCommandArgs(commandName, args);
  const actualPath = extractActualPath(error);
  const actualBase = browser?.visualService?.folders?.actualFolder;
  let pendingPath = null;

  if (actualPath && fs.existsSync(actualPath)) {
    pendingPath = copyActualToPending(actualPath, pendingBase, actualBase);
  }

  if (!pendingPath) {
    pendingPath = await savePendingBaseline(commandName, resolved.element, resolved.tag, resolved.options, pendingBase);
  }

  const baselineBase = browser?.visualService?.folders?.baselineFolder || 'report/visual-baseline';
  if (pendingPath) {
    console.warn(
      `[Visual] Missing baseline for "${resolved.tag}". Saved pending baseline at ${pendingPath}. Move it into ${baselineBase} to enable comparison.`,
    );
  } else {
    console.warn(
      `[Visual] Missing baseline for "${resolved.tag}". Unable to save pending baseline. Move the screenshot into ${baselineBase} manually.`,
    );
  }

  markMissingBaseline();
  return pendingPath;
};

const checkScreenWithBaseline = async (tag, options = {}) => {
  if (typeof browser?.checkScreen !== 'function') {
    return 0;
  }

  try {
    return await browser.checkScreen(tag, options);
  } catch (error) {
    if (!isBaselineMissingError(error)) {
      throw error;
    }

    await handleBaselineMissing({ error, commandName: 'checkScreen', tag, options });
    return 0;
  }
};

module.exports = {
  checkScreenWithBaseline,
  handleBaselineMissing,
  isBaselineMissingError,
};
