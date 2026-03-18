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

echo "=== [rebuild] Verifying service is running..."
for i in 1 2 3 4 5 6; do
  sleep 2
  STATUS=$(systemctl --user is-active mission-control 2>/dev/null || true)
  if [ "$STATUS" = "active" ]; then
    echo "=== [rebuild] ✓ Service is active! Done."
    exit 0
  fi
  echo "=== [rebuild] Status: $STATUS (attempt $i/6)..."
done

echo "=== [rebuild] ⚠ Service did not become active within 12s. Check: pm2 logs mission-control"
exit 1
