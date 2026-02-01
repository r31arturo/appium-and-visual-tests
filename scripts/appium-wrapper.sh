#!/usr/bin/env bash
set -euo pipefail

# Ensure Appium starts without tsx loader injected by WDIO in CI.
unset NODE_OPTIONS

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

exec node "${APP_ROOT}/node_modules/appium/index.js" "$@"
