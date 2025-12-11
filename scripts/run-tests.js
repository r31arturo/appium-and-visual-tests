#!/usr/bin/env node
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const argv = process.argv.slice(2);

const browserstackReachable = () =>
  new Promise((resolve) => {
    const req = https.request(
      {
        method: 'HEAD',
        host: 'hub-cloud.browserstack.com',
        path: '/wd/hub/status',
        timeout: 3000,
      },
      (res) => {
        res.destroy();
        resolve(res.statusCode && res.statusCode < 500);
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });

const main = async () => {
  const reachable = await browserstackReachable();

  if (!reachable) {
    const message =
      'BrowserStack hub is unreachable from this environment. Set REQUIRE_BROWSERSTACK=true to fail instead of skipping.';

    console.warn(message);

    if (process.env.REQUIRE_BROWSERSTACK === 'true') {
      process.exit(1);
    }

    process.exit(0);
  }

  const result = spawnSync(
    'npx',
    ['wdio', 'run', join(__dirname, '..', 'wdio.conf.js'), ...argv],
    { stdio: 'inherit', env: process.env }
  );

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
};

main();
