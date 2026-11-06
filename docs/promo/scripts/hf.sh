#!/usr/bin/env bash
# Thin wrapper: pins the CLI version and points HyperFrames at the
# chrome-headless-shell that is already on this machine (Playwright's copy),
# so renders never depend on a fresh Chrome download.
set -euo pipefail

export HYPERFRAMES_BROWSER_PATH="${HYPERFRAMES_BROWSER_PATH:-$HOME/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell}"

CLI="${HYPERFRAMES_CLI:-/home/wujue/.npm/_npx/6fd128906d9cf9eb/node_modules/.bin/hyperframes}"
exec "$CLI" "$@"
