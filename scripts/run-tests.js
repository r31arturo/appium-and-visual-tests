#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const argv = process.argv.slice(2);

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
