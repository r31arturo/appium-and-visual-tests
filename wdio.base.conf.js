const { join } = require('node:path');

const specs = ['./tests/specs/**/*.spec.js'];

const services = [
  [
    'visual',
    {
      baselineFolder: join(process.cwd(), 'visual-baseline'),
      screenshotPath: join(process.cwd(), 'visual-output'),
      formatImageName: '{tag}-{platformName}-{deviceName}-{width}x{height}',
      savePerInstance: true,
      autoSaveBaseline: true,
    },
  ],
];

const config = {
  runner: 'local',
  specs,
  maxInstances: 1,
  logLevel: 'info',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    timeout: 120000,
  },
  services,
  baseUrl: 'http://localhost',
  waitforTimeout: 20000,
  connectionRetryCount: 2,

  beforeTest: async () => {
    await driver.setTimeout({ implicit: 10000 });
  },

  afterTest: async function (test, context, { error } = {}) {
    if (error) {
      const name = `${test.parent} -- ${test.title}`.replace(/\s+/g, '-').toLowerCase();
      await browser.saveScreenshot(join('visual-output', `${name}.png`));
    }
  },
};

module.exports = { config };
