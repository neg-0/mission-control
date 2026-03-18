#!/bin/bash
# ============================================================================
# CEO Pod Health Check
# ============================================================================
# Returns 0 (healthy) if:
#   1. Pod process is running (PID file exists and process alive)
#   2. Required context files still present
#   3. Project manifest not tampered with (if mounted)
# Returns 1 (unhealthy) otherwise.
# ============================================================================

set -euo pipefail

# Check pod process
if [ -f /pod/tmp/pod.pid ]; then
  PID=$(cat /pod/tmp/pod.pid)
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "UNHEALTHY: Pod process ${PID} not running"
    exit 1
  fi
fi

# Check context files
for f in SOUL.md HEARTBEAT.md GOALS.md; do
  if [ ! -f "/pod/context/${f}" ]; then
    echo "UNHEALTHY: Missing /pod/context/${f}"
    exit 1
  fi
done

# Check manifest integrity (if present)
if [ -f "/pod/project.lock.json" ]; then
  if ! jq empty /pod/project.lock.json 2>/dev/null; then
    echo "UNHEALTHY: project.lock.json is corrupted"
    exit 1
  fi
fi

echo "HEALTHY"
exit 0
