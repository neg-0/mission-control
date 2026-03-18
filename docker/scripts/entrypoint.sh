#!/bin/bash
# ============================================================================
# CEO Pod Entrypoint
# ============================================================================
# Handles pod boot sequence:
#   1. Validate required context files exist
#   2. Validate project manifest integrity
#   3. Register with MC fleet registry
#   4. Start heartbeat loop
#   5. Execute main process or idle
# ============================================================================

set -euo pipefail

POD_LOG="/pod/logs/boot.log"
MC_URL="${MC_URL:-http://host.docker.internal:3000}"
AGENT_ID="${AGENT_ID:-unnamed}"
PROJECT_ID="${PROJECT_ID:-unknown}"
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-60}"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [pod:${AGENT_ID}] $*" | tee -a "$POD_LOG"
}

die() {
  log "FATAL: $*"
  exit 1
}

# ── Step 1: Validate context files ──────────────────────────────────
log "Booting CEO Pod: agent=${AGENT_ID} project=${PROJECT_ID} version=${POD_VERSION:-unknown}"

REQUIRED_FILES=("SOUL.md" "HEARTBEAT.md" "GOALS.md")
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "/pod/context/${f}" ]; then
    die "Required context file missing: /pod/context/${f}"
  fi
  log "  ✓ /pod/context/${f}"
done

# ── Step 2: Validate project manifest ──────────────────────────────
if [ -f "/pod/project.lock.json" ]; then
  # Check manifest is valid JSON
  if ! jq empty /pod/project.lock.json 2>/dev/null; then
    die "project.lock.json is not valid JSON"
  fi

  # Check manifest agent matches pod agent
  MANIFEST_AGENT=$(jq -r '.agentId // empty' /pod/project.lock.json)
  if [ -n "$MANIFEST_AGENT" ] && [ "$MANIFEST_AGENT" != "$AGENT_ID" ]; then
    die "Manifest agent mismatch: manifest=${MANIFEST_AGENT} pod=${AGENT_ID}"
  fi

  log "  ✓ project.lock.json (agent=${MANIFEST_AGENT})"
else
  log "  ⚠ No project.lock.json mounted (running without manifest)"
fi

# ── Step 3: Register with MC fleet registry ─────────────────────────
register_with_mc() {
  local payload
  payload=$(jq -n \
    --arg id "$AGENT_ID" \
    --arg project "$PROJECT_ID" \
    --arg version "${POD_VERSION:-unknown}" \
    '{
      agentId: $id,
      status: "active",
      capabilities: ["docker-pod"],
      metadata: {
        projectId: $project,
        podVersion: $version,
        bootTime: (now | todate)
      }
    }')

  local response
  response=$(curl -sf -X POST "${MC_URL}/api/fleet/registry" \
    -H "Content-Type: application/json" \
    -H "Bypass-Tunnel-Reminder: true" \
    -d "$payload" 2>/dev/null) || true

  if [ -n "$response" ]; then
    log "  ✓ Registered with MC fleet registry"
  else
    log "  ⚠ Could not register with MC (will retry via heartbeat)"
  fi
}

register_with_mc

# ── Step 4: Start heartbeat loop (background) ──────────────────────
heartbeat_loop() {
  while true; do
    sleep "$HEARTBEAT_INTERVAL"

    local payload
    payload=$(jq -n \
      --arg id "$AGENT_ID" \
      '{
        agentId: $id,
        status: "active"
      }')

    curl -sf -X POST "${MC_URL}/api/fleet/registry" \
      -H "Content-Type: application/json" \
      -H "Bypass-Tunnel-Reminder: true" \
      -d "$payload" >/dev/null 2>&1 || true
  done
}

heartbeat_loop &
HEARTBEAT_PID=$!
log "  ✓ Heartbeat loop started (pid=${HEARTBEAT_PID}, interval=${HEARTBEAT_INTERVAL}s)"

# ── Step 5: Graceful shutdown handler ───────────────────────────────
cleanup() {
  log "Shutting down pod..."

  # Kill heartbeat
  kill "$HEARTBEAT_PID" 2>/dev/null || true

  # Notify MC of shutdown
  local payload
  payload=$(jq -n --arg id "$AGENT_ID" '{ agentId: $id, status: "offline" }')
  curl -sf -X POST "${MC_URL}/api/fleet/registry" \
    -H "Content-Type: application/json" \
    -H "Bypass-Tunnel-Reminder: true" \
    -d "$payload" >/dev/null 2>&1 || true

  log "Pod shutdown complete."
  exit 0
}

trap cleanup SIGTERM SIGINT SIGQUIT

# ── Step 6: Main process ───────────────────────────────────────────
log "Pod boot complete. Ready for work."

# If a command was passed, execute it; otherwise idle
if [ $# -gt 0 ]; then
  log "Executing: $*"
  exec "$@"
else
  log "No command specified — entering idle mode (waiting for tasks via MC bus)"
  # Write a PID file for health check
  echo $$ > /pod/tmp/pod.pid
  # Wait forever (heartbeat runs in background)
  while true; do
    sleep 3600
  done
fi
