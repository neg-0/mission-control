#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=== [rebuild] Stopping mission-control service..."
systemctl --user stop mission-control || true
sleep 1

echo "=== [rebuild] Cleaning .next directory..."
rm -rf .next

echo "=== [rebuild] Running next build..."
node node_modules/.bin/next build
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
  echo "=== [rebuild] Build FAILED (exit $BUILD_EXIT). Not starting service."
  exit $BUILD_EXIT
fi

echo "=== [rebuild] Build succeeded. Starting mission-control service..."
systemctl --user start mission-control
sleep 2

echo "=== [rebuild] Verifying service is running..."
systemctl --user is-active mission-control && echo "=== [rebuild] ✓ Done!" || echo "=== [rebuild] ⚠ Service failed to start"
