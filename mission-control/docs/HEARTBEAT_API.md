# Mission Control Heartbeat API — Quick Reference

**Base URL:** `http://control.neg0.cloud`

---

## 1. Dashboard Status

```bash
GET /api/heartbeat/status
```

Returns timer state, config, all heartbeat schedules, recent wakes, and agent roster.

```bash
curl -s http://control.neg0.cloud/api/heartbeat/status | jq
```

**Key response fields:**
| Field | Description |
|-------|-------------|
| `timer.running` | Internal timer active? |
| `timer.tickCount` | Total ticks since boot |
| `config.enabled` | Orchestrator on/off |
| `config.staggerDelayMs` | Gap between wakes in a tick |
| `schedules[]` | Heartbeat schedule details per agent |
| `recentWakes[]` | Last hour of wake activity |

---

## 2. Orchestrator Config

```bash
# Read config
GET /api/orchestrator/config

# Update config
PATCH /api/orchestrator/config
```

```bash
# Enable orchestrator + set tick to 2 minutes
curl -s -X PATCH http://control.neg0.cloud/api/orchestrator/config \
  -H 'Content-Type: application/json' \
  -d '{"enabled": true, "tickIntervalMs": 120000}' | jq

# Disable orchestrator
curl -s -X PATCH http://control.neg0.cloud/api/orchestrator/config \
  -H 'Content-Type: application/json' \
  -d '{"enabled": false}' | jq
```

**Config fields:**
| Field | Range | Default | Description |
|-------|-------|---------|-------------|
| `enabled` | bool | `true` | Global on/off |
| `maxWakesPerTick` | 1–20 | `2` | Agents woken per tick |
| `staggerDelayMs` | ≥5000 | `30000` | Gap between wakes (ms) |
| `tickIntervalMs` | ≥10000 | `60000` | Timer frequency (ms) |
| `tpmLimit` | int\|null | `null` | Token-per-minute cap |

---

## 3. Schedules CRUD

```bash
GET    /api/schedules              # List all
POST   /api/schedules              # Create
PATCH  /api/schedules              # Update
DELETE /api/schedules              # Delete
```

### Create a heartbeat schedule

```bash
curl -s -X POST http://control.neg0.cloud/api/schedules \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "rocket",
    "type": "heartbeat",
    "name": "Heartbeat",
    "intervalMs": 1800000,
    "priority": 1,
    "payload": "🤖 Heartbeat: Read HEARTBEAT.md, run roster_checkin, check task_list, report status.",
    "channel": "discord",
    "deliverTo": "user:339585248826228749",
    "enabled": true
  }' | jq
```

### Toggle a schedule on/off

```bash
curl -s -X PATCH http://control.neg0.cloud/api/schedules \
  -H 'Content-Type: application/json' \
  -d '{"id": "<schedule-uuid>", "enabled": false}' | jq
```

### Change interval to 45 minutes

```bash
curl -s -X PATCH http://control.neg0.cloud/api/schedules \
  -H 'Content-Type: application/json' \
  -d '{"id": "<schedule-uuid>", "intervalMs": 2700000}' | jq
```

### Delete a schedule

```bash
curl -s -X DELETE http://control.neg0.cloud/api/schedules \
  -H 'Content-Type: application/json' \
  -d '{"id": "<schedule-uuid>"}' | jq
```

**Schedule fields:**
| Field | Required | Description |
|-------|----------|-------------|
| `agentId` | ✅ | Agent ID (e.g. `"rocket"`, `"captain"`) |
| `type` | ✅ | `"heartbeat"` for MC-managed |
| `name` | ✅ | Display name |
| `intervalMs` | one of | Fixed interval in ms (min 10000) |
| `cronExpr` | one of | Cron expression (mutually exclusive with intervalMs) |
| `priority` | | 0–100, higher = first in tick queue |
| `payload` | | Message sent to agent on wake |
| `channel` | | `"discord"`, `"none"`, etc. Default: `"discord"` |
| `deliverTo` | | Target within channel, e.g. `"user:339585248826228749"` |
| `enabled` | | Default: `true` |

---

## 4. Manual Tick Trigger

```bash
# Force one tick cycle immediately
curl -s -X POST http://control.neg0.cloud/api/orchestrator/tick | jq

# Quick tick status check
curl -s http://control.neg0.cloud/api/orchestrator/tick | jq
```

---

## How It Works

The orchestrator runs an internal timer (default: every 60s). Each tick:
1. Queries heartbeat schedules where `nextRunAt ≤ now`
2. Takes up to `maxWakesPerTick` agents, sorted by priority
3. Calls OpenClaw **`/hooks/agent`** per agent with stagger delay between each
4. Logs every wake to `MessageLog` for audit
5. Advances `nextRunAt` for each processed schedule

Each wake hits the gateway with the agent's configured `channel` and `deliverTo`, running an isolated session — no conflict with other agents or the native heartbeat system.
