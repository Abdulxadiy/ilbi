#!/bin/sh
set -eu
if ! sha256sum -c node_modules/.ilbi-dependencies.sha256 >/dev/null 2>&1; then
  echo "Syncing mobile dependencies..."
  npm ci --no-audit --no-fund
  sha256sum package.json package-lock.json scripts/patch-toolchain.cjs vendor/deepmerge-4.3.1-prototype-guard.json > node_modules/.ilbi-dependencies.sha256
fi
exec node scripts/dev-server.mjs
