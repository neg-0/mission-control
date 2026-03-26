# WSL2 Agent Fleet — Complete Implementation Plan

> **Status:** Draft / Actionable
> **Author:** Dustin + Claude
> **Date:** 2026-03-22
> **Target Hardware:** Windows Desktop — 48GB RAM, 8-16 cores
> **Goal:** Run a fleet of Claude Code CLI agent instances in WSL2, orchestrated by Mission Control, managed by pm2, auto-starting on boot.

---

## Overview

Each agent is a lightweight Node.js **wrapper process** managed by pm2. When Mission Control's orchestrator fires a heartbeat (or the MC daemon detects a pending message), the wrapper:

1. Fetches the enriched context from MC's `/api/heartbeat-preview` endpoint
2. Spawns `claude -p "[context]" --dangerously-skip-permissions` in the agent's workspace
3. Streams and captures output to a log file
4. POSTs the result to `/api/journal` and ACKs the message on the bus

This matches how the existing orchestrator works (OpenClaw gateway → agent wake) but replaces the OpenClaw layer with Claude Code CLI directly.

```
Windows Host (48GB RAM)
└── WSL2 Ubuntu 24.04 (32GB RAM)
    ├── Mission Control (Next.js, port 3000) — already running
    ├── pm2 daemon
    │   ├── mc-daemon (Node.js — fleet supervisor, health monitor)
    │   ├── agent-rocket    (Node.js wrapper → spawns claude CLI)
    │   ├── agent-moose     (Node.js wrapper → spawns claude CLI)
    │   ├── agent-sarge     (Node.js wrapper → spawns claude CLI)
    │   ├── agent-captain   (Node.js wrapper → spawns claude CLI)
    │   └── ... (one per active agent)
    └── ~/workspaces/
        ├── workspace-rocket/   (CLAUDE.md + project files)
        ├── workspace-moose/
        ├── workspace-sarge/    → Chocks codebase
        ├── workspace-captain/  → ShipLog codebase
        └── ...
```

---

## Section 1: WSL2 Environment Setup

### 1.1 .wslconfig (Windows-side, save to `C:\Users\<you>\.wslconfig`)

```ini
[wsl2]
# Leave ~16GB for Windows. Claude Code instances + Node processes fit in 32GB.
memory=32GB
processors=12
swap=8GB
swapFile=C:\\Temp\\wsl-swap.vhdx

# Disable GUI to save RAM
guiApplications=false

# Disable VM idle timeout (keep WSL2 alive)
vmIdleTimeout=0

# Enable localhost forwarding (for accessing MC from Windows browser)
localhostForwarding=true

[experimental]
# Reclaim WSL2 memory when processes exit
autoMemoryReclaim=gradual
# Use sparse VHD to reduce disk footprint
sparseVhd=true
```

Apply with: `wsl --shutdown` then reboot.

### 1.2 Ubuntu 24.04 Setup

```bash
# Install Ubuntu 24.04 (run in PowerShell as admin)
wsl --install -d Ubuntu-24.04

# Once inside WSL2:
sudo apt-get update && sudo apt-get upgrade -y

# Core packages
sudo apt-get install -y \
  curl wget git jq tmux htop \
  build-essential \
  ca-certificates gnupg

# Node.js 22 LTS via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
nvm alias default 22

# Verify
node --version   # v22.x.x
npm --version    # 10.x.x

# pm2 globally
npm install -g pm2

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify claude auth works
claude --version

# Enable systemd in WSL2 — required for pm2 startup service, native cron, and systemd timers.
# Without this, cron jobs and pm2 startup silently do nothing after WSL2 restart.
echo '[boot]
systemd=true' | sudo tee /etc/wsl.conf

# Exit WSL2 and restart from PowerShell to activate systemd:
#   wsl --shutdown
# (WSL2 will start with systemd on next launch)
```

### 1.3 Authenticate Claude Code in WSL2

```bash
# Claude Code auth uses OAuth — needs a browser token exchange.
# On headless WSL2, use ANTHROPIC_API_KEY directly (recommended for fleet).

# Option A: API key (recommended for fleet operation — no browser needed)
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.bashrc
source ~/.bashrc

# Option B: OAuth via claude auth (opens browser on Windows side via WSLg or copy-paste URL)
claude auth

# Verify auth
claude -p "say hello" --max-turns 1
```

### 1.4 Windows Power Settings (run in PowerShell as admin)

```powershell
# Prevent sleep/hibernate (critical — WSL2 dies on sleep)
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 30
powercfg /setactive SCHEME_MIN   # High Performance power plan

# Disable fast startup (can corrupt WSL2 state on "shutdown")
powercfg /hibernate off

# Disable USB selective suspend
powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
```

### 1.5 Defer Windows Updates (Group Policy)

Open `gpedit.msc` → Computer Configuration → Administrative Templates → Windows Components → Windows Update → Manage End User Experience:

- **Configure Automatic Updates** → Enabled → Option: 2 (Notify for download, prompt before install)
- **No auto-restart with logged on users** → Enabled

Or via registry (PowerShell as admin):
```powershell
# Defer quality updates 30 days, feature updates 365 days
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" /v DeferQualityUpdates /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" /v DeferQualityUpdatesPeriodInDays /t REG_DWORD /d 30 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" /v DeferFeatureUpdates /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" /v DeferFeatureUpdatesPeriodInDays /t REG_DWORD /d 365 /f
```

### 1.6 Auto-Start WSL2 on Windows Boot (Task Scheduler)

Save as `C:\scripts\start-wsl-fleet.bat`:
```batch
@echo off
wsl -d Ubuntu-24.04 -u neg0 -- bash -lc "pm2 resurrect && pm2 save"
```

Then in Task Scheduler (taskschd.msc):
- **Trigger:** At startup, delay 1 minute (let networking settle)
- **Action:** Run `C:\scripts\start-wsl-fleet.bat`
- **General:** Run whether user is logged on or not, Run with highest privileges
- **Conditions:** Uncheck "Start only if on AC power"
- **Settings:** Check "Run task as soon as possible after a scheduled start is missed"

---

## Section 2: Workspace Layout

### 2.1 Directory Structure

```
/home/neg0/
├── workspaces/
│   ├── workspace-rocket/      # COO + shared services
│   │   ├── CLAUDE.md          # Soul file (see Section 3)
│   │   ├── IDENTITY.md
│   │   ├── SOUL.md
│   │   └── (no product code — orchestrator only)
│   ├── workspace-moose/       # Marketing agent
│   │   ├── CLAUDE.md
│   │   └── (marketing assets, campaign scripts)
│   ├── workspace-sarge/       # Chocks CEO
│   │   ├── CLAUDE.md
│   │   └── (Chocks codebase clone or symlink)
│   ├── workspace-captain/     # ShipLog CEO
│   │   ├── CLAUDE.md
│   │   └── (ShipLog codebase clone or symlink)
│   ├── workspace-prospector/
│   ├── workspace-designer/
│   └── workspace-gardener/
├── fleet/
│   ├── agent-wrapper.js       # Shared wrapper script (all agents use this)
│   ├── mc-daemon.js           # Fleet health supervisor daemon
│   ├── ecosystem.config.js    # pm2 config
│   └── logs/                  # Per-agent log files
└── mission-control/           # MC Next.js repo
```

### 2.2 Create Workspace Directories

```bash
mkdir -p /home/neg0/workspaces/{workspace-rocket,workspace-moose,workspace-sarge,workspace-captain,workspace-prospector,workspace-designer,workspace-gardener,workspace-refiner,workspace-accountant,workspace-architect}
mkdir -p /home/neg0/fleet/logs
```

---

## Section 3: Agent Identity (CLAUDE.md Soul Files)

### 3.1 Template

Each agent's workspace gets a `CLAUDE.md` that defines identity, behavior constraints, and MC integration. Claude Code automatically loads this file on every invocation in that directory.

```markdown
# [AGENT_NAME] — [AGENT_ROLE]

## Identity

You are **[AGENT_NAME]**, the [AGENT_ROLE] for Negative Zero.

Agent ID: `[AGENT_ID]`
Workspace: `/home/neg0/workspaces/workspace-[AGENT_ID]/`
Port: [PORT]

## Mission Control Integration

**MC URL:** `http://localhost:3000`

On every wake, you MUST:
1. Read your current context from `GET http://localhost:3000/api/heartbeat-preview?agentId=[AGENT_ID]`
2. Check your message queue: `GET http://localhost:3000/api/messages/bus?agentId=[AGENT_ID]&status=sent`
3. Work on tasks from highest priority first
4. Write a journal entry BEFORE exiting:
   POST http://localhost:3000/api/journal
   Body: { "agentId": "[AGENT_ID]", "did": "...", "next": "...", "status": "healthy|blocked|idle", "blockers": [] }
5. ACK all messages you processed:
   PATCH http://localhost:3000/api/messages/bus
   Body: { "messageId": "...", "status": "ack" }

## Autonomy Rules

- **NEVER** spawn more than 1 sub-agent (to prevent runaway memory usage)
- **NEVER** run tests in parallel — use --runInBand or sequential flags
- **NEVER** `rm -rf` without an explicit path in the task description
- **NEVER** push to main branch directly — always open a PR
- **NEVER** exceed the monthly budget in your ProjectConstraint
- **DO** escalate blockers immediately: POST http://localhost:3000/api/escalations
- **DO** delegate cross-agent tasks via MC message bus, not direct agent calls
- **DO** exit cleanly after completing each task batch — do not loop indefinitely
- **Max iterations:** 25 tool calls per session. If not done, journal progress and exit.

## Communication

To send a message to another agent:
  POST http://localhost:3000/api/messages/bus
  { "from": "[AGENT_ID]", "to": "TARGET_ID", "channel": "task",
    "subject": "...", "body": "...", "priority": "medium" }

To escalate to Dustin:
  POST http://localhost:3000/api/escalations
  { "fromAgentId": "[AGENT_ID]", "severity": "warning",
    "category": "blocker", "title": "...", "description": "..." }
```

### 3.2 Agent-Specific CLAUDE.md Files

#### `workspace-rocket/CLAUDE.md`
```markdown
# Rocket — COO / Fleet Orchestrator

## Identity
You are **Rocket**, the Chief Operating Officer for Negative Zero.
Agent ID: `rocket` | Port: `18000`

Your primary responsibilities:
- Monitor all active CEO agents and shared services
- Unblock agents who have open escalations (GET /api/escalations?status=open)
- Coordinate cross-agent task delegation via the MC message bus
- Review and approve deploys flagged for COO sign-off
- Spawn new CEO workspaces when high-scoring ideas are approved

[Paste full soul content from docker/context/rocket/SOUL.md here]

## Scope
- You may access any project in the fleet
- You may send messages to any agent
- You may NOT directly edit code in product repos — delegate to the CEO

[Paste standard MC Integration and Autonomy Rules blocks]
```

#### `workspace-sarge/CLAUDE.md`
```markdown
# Sarge — Chocks CEO

## Identity
You are **Sarge**, the CEO of Chocks (anti-CPQ sales configurator).
Agent ID: `sarge` | Port: `18010`

Product: Chocks (https://chocks.ai)
Codebase: This workspace directory contains the Chocks repository.
Deploy: Railway (auto-deployed from main branch via GitHub Actions)
Database: Railway PostgreSQL

Your primary responsibilities:
- Ship features to meet weekly milestones (check active Goals in MC)
- Monitor Railway deploys — fix failures within 1 heartbeat
- Respond to QA failures from GitHub Actions CI
- Grow MRR toward the target in your active Goals

## Scope (ProjectConstraint)
- Protected files: `prisma/schema.prisma` (schema changes require Dustin review — open a PR)
- Forbidden ops: direct database drops, deleting env vars in Railway UI
- Monthly budget: $50 Railway compute (escalate if approaching limit)

[Paste standard MC Integration and Autonomy Rules blocks]
```

#### `workspace-captain/CLAUDE.md`
```markdown
# Captain — ShipLog CEO

## Identity
You are **Captain**, the CEO of ShipLog.
Agent ID: `captain` | Port: `18011`

Product: ShipLog (https://shiplog.dev)
[mirror structure from Sarge with ShipLog-specific details]
```

### 3.3 Bootstrap Script for Soul Files

```bash
#!/bin/bash
# /home/neg0/fleet/init-souls.sh
# Creates CLAUDE.md stubs for any agent workspace that doesn't have one yet.

AGENTS=(
  "rocket:18000:COO / Fleet Orchestrator"
  "moose:18001:Marketing Agent"
  "sarge:18010:Chocks CEO"
  "captain:18011:ShipLog CEO"
  "prospector:18020:Idea Scout"
  "designer:18021:UI/UX Designer"
  "gardener:18022:Health Monitor"
  "refiner:18023:Idea Refiner"
  "accountant:18024:Finance Agent"
  "architect:18025:Systems Architect"
)

MC_URL="http://localhost:3000"

for entry in "${AGENTS[@]}"; do
  IFS=: read -r id port role <<< "$entry"
  workspace="/home/neg0/workspaces/workspace-$id"
  mkdir -p "$workspace"

  if [ ! -f "$workspace/CLAUDE.md" ]; then
    cat > "$workspace/CLAUDE.md" << SOUL
# ${id} — ${role}

## Identity
You are **${id}**, the ${role} for Negative Zero.
Agent ID: \`${id}\` | Port: \`${port}\`

## Mission Control Integration

**MC URL:** \`${MC_URL}\`

On every wake:
1. Check message queue: GET ${MC_URL}/api/messages/bus?agentId=${id}&status=sent
2. Fetch context: GET ${MC_URL}/api/heartbeat-preview?agentId=${id}
3. Work on highest priority tasks
4. Log journal before exit: POST ${MC_URL}/api/journal
5. ACK processed messages: PATCH ${MC_URL}/api/messages/bus

## Autonomy Rules
- NEVER spawn more than 1 sub-agent
- NEVER run tests in parallel (use --runInBand)
- NEVER push to main — open PRs only
- DO escalate blockers via POST ${MC_URL}/api/escalations
- DO exit after completing task batch (max 25 tool call iterations)
SOUL
    echo "Created CLAUDE.md for $id"
  else
    echo "Skipped $id (already exists)"
  fi
done
```

---

## Section 4: Agent Wrapper Script

### 4.1 `/home/neg0/fleet/agent-wrapper.js`

This is the script pm2 actually runs, one instance per agent. It polls MC's message bus and spawns `claude` when work is queued.

```javascript
#!/usr/bin/env node
/**
 * Agent Wrapper — runs as a pm2 process, one per agent.
 *
 * Lifecycle:
 *  1. On startup, POST /api/journal { status: "idle" } to register as online
 *  2. Every POLL_INTERVAL ms, GET /api/messages/bus?agentId=X&status=sent
 *  3. If messages exist, fetch heartbeat context from /api/heartbeat-preview
 *  4. Spawn: claude -p "[context]" --dangerously-skip-permissions --max-turns 25
 *  5. Stream output to log file
 *  6. ACK all messages on session completion
 *
 * Environment variables (set in ecosystem.config.js):
 *   AGENT_ID        - e.g. "rocket"
 *   MC_URL          - e.g. "http://localhost:3000"
 *   WORKSPACE_PATH  - e.g. "/home/neg0/workspaces/workspace-rocket"
 *   POLL_INTERVAL   - milliseconds between bus polls (default: 5000)
 *   LOG_PATH        - where to write claude output logs
 */

const { spawn } = require('child_process');
const fs = require('fs');

const AGENT_ID = process.env.AGENT_ID;
const MC_URL = process.env.MC_URL || 'http://localhost:3000';
const WORKSPACE_PATH = process.env.WORKSPACE_PATH;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000', 10);
const LOG_PATH = process.env.LOG_PATH || `/home/neg0/fleet/logs/${AGENT_ID}.log`;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minute hard cap per session
const DAEMON_SEMAPHORE_URL = 'http://127.0.0.1:18099'; // mc-daemon concurrency semaphore

if (!AGENT_ID || !WORKSPACE_PATH) {
  console.error('AGENT_ID and WORKSPACE_PATH are required');
  process.exit(1);
}

let isRunning = false;
let sessionCount = 0;

// ─── Utilities ───────────────────────────────────────────────────────────────

async function mcFetch(path, options = {}) {
  const res = await fetch(`${MC_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MC ${options.method || 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

function appendLog(text) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_PATH, `[${timestamp}] ${text}\n`);
  process.stdout.write(`[${AGENT_ID}] ${text}\n`);
}

// ─── Startup Registration ─────────────────────────────────────────────────────

async function registerOnline() {
  try {
    await mcFetch('/api/journal', {
      method: 'POST',
      body: JSON.stringify({
        agentId: AGENT_ID,
        did: 'Agent wrapper process started (pm2 restart or boot)',
        next: 'Polling message bus for work',
        status: 'idle',
        blockers: [],
      }),
    });
    appendLog('Registered as online with MC');
  } catch (err) {
    appendLog(`WARNING: Could not register online: ${err.message}`);
  }
}

// ─── Message Bus ──────────────────────────────────────────────────────────────

async function fetchPendingMessages() {
  const data = await mcFetch(
    `/api/messages/bus?agentId=${AGENT_ID}&status=sent&limit=5`
  );
  return data.messages || [];
}

async function ackMessages(messageIds) {
  for (const id of messageIds) {
    try {
      await mcFetch('/api/messages/bus', {
        method: 'PATCH',
        body: JSON.stringify({ messageId: id, status: 'ack' }),
      });
    } catch (err) {
      appendLog(`WARNING: Could not ACK message ${id}: ${err.message}`);
    }
  }
}

// ─── Heartbeat Context ────────────────────────────────────────────────────────

async function fetchHeartbeatContext() {
  try {
    const data = await mcFetch(
      `/api/heartbeat-preview?agentId=${AGENT_ID}&scheduleName=Heartbeat`
    );
    return data.message || '';
  } catch (err) {
    appendLog(`WARNING: Could not fetch heartbeat context: ${err.message}`);
    return `You are ${AGENT_ID}. Check your message queue at ${MC_URL}/api/messages/bus?agentId=${AGENT_ID}&status=sent and complete any pending tasks. Log a journal entry when done.`;
  }
}

// ─── Claude Session ───────────────────────────────────────────────────────────

function runClaudeSession(prompt) {
  return new Promise((resolve, reject) => {
    sessionCount++;
    appendLog(`Starting Claude session #${sessionCount}`);

    const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });

    // Use spawn (not exec/execSync) to avoid shell injection and get streaming output
    const claude = spawn('claude', [
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--max-turns', '25',
      '--output-format', 'text',
    ], {
      cwd: WORKSPACE_PATH,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const startTime = Date.now();

    claude.stdout.on('data', (data) => logStream.write(`[stdout] ${data}`));
    claude.stderr.on('data', (data) => logStream.write(`[stderr] ${data}`));

    const timeoutHandle = setTimeout(() => {
      appendLog('WARNING: Session exceeded 30min timeout, sending SIGTERM');
      claude.kill('SIGTERM');
    }, SESSION_TIMEOUT_MS);

    claude.on('close', (code) => {
      clearTimeout(timeoutHandle);
      logStream.end();
      const duration = Math.round((Date.now() - startTime) / 1000);
      appendLog(`Session #${sessionCount} exited (code=${code}, duration=${duration}s)`);
      if (code === 0 || code === null) {
        resolve(code);
      } else {
        reject(new Error(`Claude exited with code ${code}`));
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timeoutHandle);
      logStream.end();
      reject(err);
    });
  });
}

// ─── Main Poll Loop ───────────────────────────────────────────────────────────

async function acquireSemaphore() {
  try {
    const res = await fetch(`${DAEMON_SEMAPHORE_URL}/semaphore/acquire?agentId=${AGENT_ID}`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      appendLog(`Semaphore: fleet at capacity (${data.active}/${data.limit}) — skipping tick`);
      return false;
    }
    return true;
  } catch (_err) {
    // mc-daemon not reachable — proceed without semaphore (daemon may be starting up)
    return true;
  }
}

async function releaseSemaphore() {
  try {
    await fetch(`${DAEMON_SEMAPHORE_URL}/semaphore/release?agentId=${AGENT_ID}`, { method: 'POST' });
  } catch (_err) { /* best-effort */ }
}

async function tick() {
  if (isRunning) return; // Skip poll if session is already running

  try {
    const messages = await fetchPendingMessages();
    if (messages.length === 0) return;

    // Check fleet-wide concurrency limit before spawning
    const slotGranted = await acquireSemaphore();
    if (!slotGranted) return;

    isRunning = true;
    const messageIds = messages.map((m) => m.id);
    appendLog(`${messages.length} pending messages — starting session`);

    // Fetch enriched heartbeat context (journal, tasks, goals, MD injections)
    const context = await fetchHeartbeatContext();

    // Append inbox summary to context
    const inbox = messages
      .map((m) => `FROM: ${m.fromId}\nCHANNEL: ${m.channel}\nSUBJECT: ${m.subject}\n\n${m.body}`)
      .join('\n\n---\n\n');

    const fullPrompt = `${context}\n\n## Inbox (${messages.length} new messages)\n\n${inbox}`;

    try {
      await runClaudeSession(fullPrompt);
      await ackMessages(messageIds);
    } catch (err) {
      appendLog(`ERROR: Claude session failed: ${err.message}`);
      try {
        await mcFetch('/api/escalations', {
          method: 'POST',
          body: JSON.stringify({
            fromAgentId: AGENT_ID,
            severity: 'warning',
            category: 'session_failure',
            title: `Claude session failed for ${AGENT_ID}`,
            description: err.message,
          }),
        });
      } catch (_) { /* escalation is best-effort */ }
    }
  } catch (err) {
    appendLog(`ERROR: Poll tick failed: ${err.message}`);
  } finally {
    isRunning = false;
    await releaseSemaphore();
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function main() {
  appendLog(`Agent wrapper starting: ${AGENT_ID}`);
  appendLog(`MC: ${MC_URL} | Workspace: ${WORKSPACE_PATH} | Poll: ${POLL_INTERVAL}ms`);

  await registerOnline();
  setTimeout(tick, 2000);           // Initial check after 2s
  setInterval(tick, POLL_INTERVAL); // Recurring poll

  appendLog('Polling for messages...');
}

main().catch((err) => {
  console.error(`[${AGENT_ID}] Fatal:`, err);
  process.exit(1);
});
```

---

## Section 5: pm2 Ecosystem Config

### 5.1 `/home/neg0/fleet/ecosystem.config.js`

```javascript
/**
 * pm2 ecosystem config for the Negative Zero agent fleet.
 *
 * Port assignments:
 *   18000-18009  Shared services (Rocket, Moose)
 *   18010-18019  Active CEO agents (Sarge, Captain)
 *   18020-18029  Pipeline agents (Prospector, Designer, Gardener, etc.)
 *   18030-18099  Reserved for future CEO spawns
 *
 * Memory limits (pm2 restarts the wrapper process if exceeded):
 *   CEO agents:       4GB — they spawn claude which can use significant RAM
 *   Shared services:  2GB
 *   mc-daemon:      512MB
 *
 * ANTHROPIC_API_KEY must be set in the environment before running pm2 start.
 * Add to /home/neg0/.env.fleet and source it in ~/.bashrc.
 */

const FLEET_DIR = '/home/neg0/fleet';
const WORKSPACE_DIR = '/home/neg0/workspaces';
const MC_URL = 'http://localhost:3000';
const POLL_INTERVAL = '5000'; // 5 seconds

function agentProcess(id, port, options = {}) {
  return {
    name: `agent-${id}`,
    script: `${FLEET_DIR}/agent-wrapper.js`,
    cwd: `${WORKSPACE_DIR}/workspace-${id}`,
    max_memory_restart: options.memory || '4G',
    env: {
      AGENT_ID: id,
      MC_URL,
      WORKSPACE_PATH: `${WORKSPACE_DIR}/workspace-${id}`,
      POLL_INTERVAL,
      LOG_PATH: `${FLEET_DIR}/logs/${id}.log`,
      AGENT_PORT: String(port),
      NODE_ENV: 'production',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    },
    autorestart: true,
    restart_delay: 10000,     // 10s cooldown between restarts
    max_restarts: 10,         // Give up after 10 crashes in the window
    min_uptime: '30s',        // Must survive 30s to count as stable
    watch: false,
    instances: 1,
    exec_mode: 'fork',
    output: `${FLEET_DIR}/logs/${id}-out.log`,
    error: `${FLEET_DIR}/logs/${id}-err.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: false,
  };
}

module.exports = {
  apps: [
    // ─── Fleet Supervisor ────────────────────────────────────────────────────
    {
      name: 'mc-daemon',
      script: `${FLEET_DIR}/mc-daemon.js`,
      cwd: FLEET_DIR,
      max_memory_restart: '512M',
      env: {
        MC_URL,
        NODE_ENV: 'production',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
      autorestart: true,
      restart_delay: 5000,
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      output: `${FLEET_DIR}/logs/mc-daemon-out.log`,
      error: `${FLEET_DIR}/logs/mc-daemon-err.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ─── Shared Services ─────────────────────────────────────────────────────
    agentProcess('rocket',     18000, { memory: '4G' }),
    agentProcess('moose',      18001, { memory: '2G' }),

    // ─── Active CEO Agents ───────────────────────────────────────────────────
    agentProcess('sarge',      18010, { memory: '4G' }),  // Chocks
    agentProcess('captain',    18011, { memory: '4G' }),  // ShipLog

    // ─── Pipeline Agents ─────────────────────────────────────────────────────
    agentProcess('prospector', 18020, { memory: '2G' }),
    agentProcess('designer',   18021, { memory: '2G' }),
    agentProcess('gardener',   18022, { memory: '2G' }),
    agentProcess('refiner',    18023, { memory: '2G' }),
    agentProcess('accountant', 18024, { memory: '2G' }),
    agentProcess('architect',  18025, { memory: '2G' }),
  ],
};
```

### 5.2 Port Range Reference Table

| Range | Assignment |
|-------|-----------|
| 3000 | Mission Control (Next.js) |
| 18000 | rocket (COO) |
| 18001 | moose (Marketing) |
| 18002–18009 | Reserved (shared services) |
| 18010 | sarge (Chocks CEO) |
| 18011 | captain (ShipLog CEO) |
| 18012–18019 | Next 8 CEO spawns |
| 18020 | prospector |
| 18021 | designer |
| 18022 | gardener |
| 18023 | refiner |
| 18024 | accountant |
| 18025 | architect |
| 18026–18029 | Reserved (pipeline agents) |
| 18030–18099 | Future CEO agents (auto-assigned on spawn) |

### 5.3 Start and Save Fleet State

```bash
# Source env vars (ANTHROPIC_API_KEY must be set)
source ~/.env.fleet

cd /home/neg0/fleet

# First launch
pm2 start ecosystem.config.js

# Persist state for pm2 resurrect on boot
pm2 save

# Configure pm2 to auto-start on WSL2 boot (requires systemd — see Section 9.2)
pm2 startup systemd -u neg0 --hp /home/neg0
# Run the sudo command it prints

# Verify
pm2 list
pm2 monit
```

---

## Section 6: MC Daemon Architecture

### 6.1 Purpose

The mc-daemon is a **fleet-level supervisor** — separate from the per-agent wrappers — that:

- Monitors pm2 process states every 30 seconds (detects crashes, errored status)
- Monitors MC heartbeat timestamps (detects silent agents)
- Creates MC escalations for dead/silent agents (de-duplicated, no spam)
- Acts as fallback waker: if the MC orchestrator stalls, triggers a manual tick
- Enforces a fleet-wide concurrency limit: max **3** simultaneous active claude sessions (agents beyond the limit skip their tick and retry next poll)
- Circuit breaker: pauses all agent polling if MC API is unreachable for 3 consecutive polls (~60s) and logs an escalation; resumes automatically when MC recovers

### 6.2 `/home/neg0/fleet/mc-daemon.js`

```javascript
#!/usr/bin/env node
/**
 * MC Daemon — fleet health supervisor.
 *
 * Uses spawn() (not exec/execSync) to query pm2's JSON status safely.
 * Reads pm2 list as a child process to avoid shell injection.
 */

const { spawn } = require('child_process');
const http = require('http');

const MC_URL = process.env.MC_URL || 'http://localhost:3000';
const HEALTH_POLL_INTERVAL = 30 * 1000;       // 30 seconds
const SUMMARY_LOG_INTERVAL = 10 * 60 * 1000;  // 10 minutes
const SILENT_THRESHOLD = 2 * 60 * 60 * 1000;  // 2 hours
const DEAD_THRESHOLD   = 4 * 60 * 60 * 1000;  // 4 hours

// De-duplicate alerts: don't re-alert on same severity within 2 hours
const alertedAgents = new Map();

// ─── Concurrency Semaphore ────────────────────────────────────────────────────

const MAX_CONCURRENT_SESSIONS = 3; // Max simultaneous active claude sessions fleet-wide
const runningAgents = new Set();   // Agent IDs that currently have a live claude process

// Expose a local HTTP endpoint so agent-wrapper.js instances can acquire/release
// session slots before spawning claude. Port 18099 is reserved for this.
//
// agent-wrapper POSTs /semaphore/acquire?agentId=X before spawning claude.
//   → 200 { ok: true }  — slot granted, proceed
//   → 429 { ok: false } — limit hit, skip this tick and retry next poll interval
//
// agent-wrapper POSTs /semaphore/release?agentId=X in the finally block.
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const agentId = url.searchParams.get('agentId');
  if (!agentId) { res.writeHead(400); return res.end(); }

  if (req.method === 'POST' && url.pathname === '/semaphore/acquire') {
    if (runningAgents.size >= MAX_CONCURRENT_SESSIONS) {
      res.writeHead(429);
      res.end(JSON.stringify({ ok: false, active: runningAgents.size, limit: MAX_CONCURRENT_SESSIONS }));
      log(`Semaphore: ${agentId} queued — limit reached (${runningAgents.size}/${MAX_CONCURRENT_SESSIONS})`);
    } else {
      runningAgents.add(agentId);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, active: runningAgents.size }));
      log(`Semaphore: ${agentId} acquired (${runningAgents.size}/${MAX_CONCURRENT_SESSIONS})`);
    }
  } else if (req.method === 'POST' && url.pathname === '/semaphore/release') {
    runningAgents.delete(agentId);
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, active: runningAgents.size }));
    log(`Semaphore: ${agentId} released (${runningAgents.size}/${MAX_CONCURRENT_SESSIONS})`);
  } else {
    res.writeHead(404); res.end();
  }
}).listen(18099, '127.0.0.1', () => log('Semaphore server listening on :18099'));

// ─── MC Circuit Breaker ───────────────────────────────────────────────────────
//
// If MC API is unreachable for 3 consecutive polls (~60s at 30s interval),
// pause all health checks and log a local escalation. Resume automatically
// when MC comes back. This prevents the daemon from spamming logs and prevents
// agents from burning API quota with fallback prompts during MC outages.

let mcFailureCount = 0;
let mcCircuitOpen = false; // true = MC unreachable, polling paused
const MC_CIRCUIT_THRESHOLD = 3; // Consecutive failures before opening circuit

async function checkMcCircuit() {
  try {
    // Use a lightweight ping — any fast MC endpoint works
    await fetch(`${MC_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (mcCircuitOpen) {
      mcCircuitOpen = false;
      mcFailureCount = 0;
      log('MC API restored — circuit closed, resuming fleet polling');
    } else {
      mcFailureCount = 0;
    }
    return true;
  } catch (_err) {
    mcFailureCount++;
    log(`WARNING: MC API unreachable (${mcFailureCount}/${MC_CIRCUIT_THRESHOLD})`);
    if (mcFailureCount >= MC_CIRCUIT_THRESHOLD && !mcCircuitOpen) {
      mcCircuitOpen = true;
      log('CIRCUIT BREAKER OPEN: MC API unreachable for 3 polls — pausing all agent polling');
      log('ESCALATION (local): Fleet polling paused due to MC outage. Agents will not receive new tasks until MC recovers.');
    }
    return false;
  }
}

async function mcFetch(path, options = {}) {
  const res = await fetch(`${MC_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`MC ${options.method || 'GET'} ${path} → ${res.status}`);
  return res.json();
}

function log(msg) {
  console.log(`[mc-daemon] ${new Date().toISOString()} ${msg}`);
}

// ─── pm2 Status (via spawn, not exec) ────────────────────────────────────────

function getPm2List() {
  return new Promise((resolve) => {
    let output = '';
    const pm2 = spawn('pm2', ['jlist'], { stdio: ['ignore', 'pipe', 'ignore'] });
    pm2.stdout.on('data', (d) => { output += d; });
    pm2.on('close', () => {
      try {
        resolve(JSON.parse(output));
      } catch {
        log('WARNING: Could not parse pm2 jlist output');
        resolve([]);
      }
    });
    pm2.on('error', () => resolve([]));
  });
}

function getDeadAgents(pm2List) {
  return pm2List
    .filter(p => p.name.startsWith('agent-') && p.pm2_env.status !== 'online')
    .map(p => ({
      name: p.name,
      status: p.pm2_env.status,
      restarts: p.pm2_env.restart_time,
    }));
}

// ─── MC Agent Status ──────────────────────────────────────────────────────────

async function getFleetStatus() {
  try {
    const data = await mcFetch('/api/heartbeat/status');
    return data.agents || [];
  } catch (err) {
    log(`WARNING: Could not fetch fleet status: ${err.message}`);
    return [];
  }
}

// ─── Escalation (de-duplicated) ───────────────────────────────────────────────

async function escalate(agentId, severity, title, description) {
  const lastAlert = alertedAgents.get(agentId);
  if (lastAlert?.severity === severity) {
    const age = Date.now() - lastAlert.lastAlerted;
    if (age < 2 * 60 * 60 * 1000) return; // Already alerted recently
  }

  try {
    await mcFetch('/api/escalations', {
      method: 'POST',
      body: JSON.stringify({
        fromAgentId: 'mc-daemon',
        severity,
        category: 'fleet_health',
        title,
        description,
      }),
    });
    alertedAgents.set(agentId, { lastAlerted: Date.now(), severity });
    log(`Escalation [${severity}]: ${title}`);
  } catch (err) {
    log(`ERROR: Could not create escalation: ${err.message}`);
  }
}

// ─── Fallback Orchestrator Tick ───────────────────────────────────────────────

let lastKnownTick = Date.now();
const STALL_THRESHOLD = 5 * 60 * 1000; // 5 minutes

async function checkOrchestratorHealth() {
  try {
    const data = await mcFetch('/api/orchestrator/tick');
    if (data.timestamp) {
      const age = Date.now() - new Date(data.timestamp).getTime();
      if (age < STALL_THRESHOLD) lastKnownTick = Date.now();
    }
  } catch (err) {
    log(`WARNING: Orchestrator status check failed: ${err.message}`);
  }

  if (Date.now() - lastKnownTick > STALL_THRESHOLD) {
    log('WARNING: Orchestrator appears stalled — triggering fallback tick');
    try {
      await mcFetch('/api/orchestrator/tick', { method: 'POST' });
      lastKnownTick = Date.now();
      log('Fallback tick triggered');
    } catch (err) {
      log(`ERROR: Fallback tick failed: ${err.message}`);
    }
  }
}

// ─── Main Health Check ────────────────────────────────────────────────────────

async function healthCheck() {
  // Circuit breaker: skip health check if MC is unreachable
  const mcOk = await checkMcCircuit();
  if (!mcOk) return; // checkMcCircuit already logged the skip reason

  const pm2List = await getPm2List();
  const dead = getDeadAgents(pm2List);

  for (const proc of dead) {
    const agentId = proc.name.replace('agent-', '');
    await escalate(
      agentId,
      proc.status === 'errored' ? 'critical' : 'warning',
      `Agent process ${proc.name} is ${proc.status}`,
      `Restart count: ${proc.restarts}. Check: /home/neg0/fleet/logs/${agentId}-err.log`
    );
  }

  const agents = await getFleetStatus();
  const now = Date.now();

  for (const agent of agents) {
    if (!agent.lastHeartbeat) continue;
    const silence = now - new Date(agent.lastHeartbeat).getTime();

    if (silence < SILENT_THRESHOLD) {
      alertedAgents.delete(agent.id); // Back online — clear alert state
      continue;
    }

    const hours = Math.round(silence / 3600000);
    if (silence > DEAD_THRESHOLD) {
      await escalate(agent.id, 'critical',
        `Agent ${agent.id} silent for ${hours}h`,
        `Last heartbeat: ${agent.lastHeartbeat}. Process may be hung or stuck in restart loop.`
      );
    } else {
      await escalate(agent.id, 'warning',
        `Agent ${agent.id} missed expected heartbeat`,
        `Last heartbeat: ${agent.lastHeartbeat} (${hours}h ago)`
      );
    }
  }

  await checkOrchestratorHealth();
}

async function logFleetSummary() {
  const pm2List = await getPm2List();
  const online = pm2List.filter(p => p.pm2_env.status === 'online').length;
  log(`Fleet: ${online}/${pm2List.length} pm2 processes online`);
}

async function main() {
  log(`Starting. MC URL: ${MC_URL}`);
  setTimeout(healthCheck, 15000); // Wait 15s for fleet to settle on startup
  setInterval(healthCheck, HEALTH_POLL_INTERVAL);
  setInterval(logFleetSummary, SUMMARY_LOG_INTERVAL);
  log('Running');
}

main().catch(err => { console.error('[mc-daemon] Fatal:', err); process.exit(1); });
```

### 6.3 Message Flow (End-to-End)

```
MC Orchestrator Tick (every 60s)
    │
    ▼
For each due schedule: POST /api/messages/bus
  { from: "orchestrator", to: "sarge", channel: "message",
    subject: "Heartbeat", body: "[enriched context]" }
    │ (status = "sent")
    ▼
agent-sarge wrapper polls GET /api/messages/bus?agentId=sarge&status=sent
    │ (message found)
    ▼
Fetch GET /api/heartbeat-preview?agentId=sarge
    │
    ▼
spawn("claude", ["-p", "[context + inbox]", "--dangerously-skip-permissions", "--max-turns", "25"])
    │
    ▼ Claude runs: journals, completes tasks, sends messages, escalates
    │
    ▼
PATCH /api/messages/bus { messageId, status: "ack" }
```

This requires one change to the MC orchestrator: add support for `runtimeMode='claude-code'` that writes to the message bus instead of calling the OpenClaw gateway. See Appendix A.

---

## Section 7: Memory Management

### 7.1 RAM Budget (48GB total)

| Component | Allocation |
|-----------|-----------|
| Windows OS + services | 16GB (outside WSL2) |
| WSL2 kernel + overhead | 1GB |
| Mission Control (Next.js) | 1GB |
| mc-daemon | 512MB |
| rocket | 4GB |
| moose | 2GB |
| sarge | 4GB |
| captain | 4GB |
| prospector | 2GB |
| designer | 2GB |
| gardener | 2GB |
| refiner | 2GB |
| accountant | 2GB |
| architect | 2GB |
| **Total WSL2** | **~30.5GB** |
| **Headroom** | ~1.5GB |

> Note: The pm2 wrapper processes idle between sessions (~50MB each). Peak usage is when multiple agents run concurrent claude sessions. The pm2 `max_memory_restart` limit restarts the **wrapper**, not claude itself — claude is ephemeral (spawned per session).

### 7.2 CLAUDE.md Memory Constraints Section

Add this block to every agent CLAUDE.md:

```markdown
## Memory Constraints

You are running in a resource-constrained fleet (shared 32GB WSL2 environment):

- **NEVER spawn more than 1 sub-agent** — sub-agents inherit context and double RAM
- **Run tests sequentially** — use `jest --runInBand`, never `--maxWorkers > 1`
- **Read files in sections** — for files > 500 lines, use offset/limit, not full reads
- **Exit cleanly** after completing your task batch — do not loop indefinitely
- **Max 25 iterations** per session. If not finished: journal progress + next step, then exit.
- **No browser automation** unless the task explicitly requires it (Playwright uses ~500MB)
```

### 7.3 Monitoring Commands

```bash
# Live dashboard (CPU, RAM, restarts per process)
pm2 monit

# Sorted by memory usage
pm2 list --sort memory

# Check WSL2 total memory from Windows (PowerShell)
wsl -d Ubuntu-24.04 -- free -h

# Force WSL2 to reclaim page cache (if memory pressure)
wsl -d Ubuntu-24.04 -- sudo sysctl vm.drop_caches=3
```

---

## Section 8: Networking

### 8.1 Outbound Access (Agents → External Services)

WSL2 has NAT networking — outbound internet access works without configuration:

- **Supabase**: Direct HTTPS from WSL2
- **Railway**: Direct HTTPS from WSL2
- **GitHub API**: Direct HTTPS from WSL2
- **Mission Control**: `http://localhost:3000` (via WSL2 loopback)

### 8.2 Inbound Access (Windows → MC Dashboard)

With `localhostForwarding=true` in .wslconfig, the Windows browser accesses MC at `http://localhost:3000`. No port forwarding needed.

For remote access (phone, other machines), use Tailscale:
```bash
# In WSL2
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# MC accessible at http://100.x.x.x:3000 from all Tailscale devices
```

### 8.3 Agent Environment Variables

```bash
# /home/neg0/.env.fleet — sourced in ~/.bashrc
export ANTHROPIC_API_KEY="sk-ant-..."
export DATABASE_URL="postgresql://..."
export NEXT_PUBLIC_MC_URL="http://localhost:3000"
```

Per-product credentials for CEO agents go in workspace `.env` files (Claude Code auto-loads these):
```bash
# /home/neg0/workspaces/workspace-sarge/.env
RAILWAY_TOKEN=...
# (other Chocks-specific vars)
```

---

## Section 9: Startup and Recovery

### 9.1 Full Boot Sequence

```
1. Windows boots
2. Task Scheduler fires start-wsl-fleet.bat (60s delay)
3. WSL2 Ubuntu 24.04 starts
4. ~/.bashrc sources /home/neg0/.env.fleet
5. pm2 resurrect — restores all processes from saved dump
6. mc-daemon starts (initial health check after 15s)
7. Each agent-wrapper starts, registers as online with MC
8. MC orchestrator fires first tick (after tickIntervalMs)
9. Heartbeat messages posted to message bus
10. Wrappers detect messages → spawn claude sessions
```

### 9.2 Enable pm2 on WSL2 Boot

WSL2 supports systemd on Ubuntu 22.04+:

```bash
# Enable systemd in WSL2 (add to /etc/wsl.conf)
echo '[boot]
systemd=true' | sudo tee -a /etc/wsl.conf

# From Windows PowerShell:
wsl --shutdown

# Back in WSL2 after restart:
pm2 startup systemd -u neg0 --hp /home/neg0
# Run the sudo command it outputs

pm2 save
```

If systemd is unavailable, use the Task Scheduler `.bat` method from Section 1.6 as the fallback.

### 9.3 Windows Task Scheduler (Fallback Boot Method)

Create `C:\scripts\start-wsl-fleet.bat`:
```batch
@echo off
timeout /t 60 /nobreak
wsl -d Ubuntu-24.04 -u neg0 -- bash -lc "source ~/.bashrc && pm2 resurrect && pm2 save"
```

Task Scheduler settings:
- **Trigger:** At startup, delay 1 minute
- **Action:** `C:\scripts\start-wsl-fleet.bat`
- **Run as:** Your user account with highest privileges
- **Run whether user is logged on:** Yes
- **If already running:** Do not start a new instance

### 9.4 WSL2 Cron Health Check

> **Prerequisite:** Cron does not run in WSL2 by default. You must enable systemd via `/etc/wsl.conf` (done in Section 1.2 and 9.2) — once systemd is active, the system cron daemon starts normally and all `crontab` entries work as expected. Without systemd, cron entries silently do nothing after WSL2 restart.

With systemd enabled, add the health check to crontab:

```bash
# crontab -e (in WSL2)
# Every 15 minutes: restart any errored pm2 processes
*/15 * * * * /home/neg0/fleet/health-check.sh >> /home/neg0/fleet/logs/cron.log 2>&1
```

`/home/neg0/fleet/health-check.sh`:
```bash
#!/bin/bash
source ~/.bashrc

echo "--- Health check $(date) ---"

# Restart errored agent processes
pm2 list --no-color | grep -E "\b(errored|stopped)\b" | awk '{print $2}' | while read -r name; do
  echo "Restarting: $name"
  pm2 restart "$name"
done

# Ensure mc-daemon is always running
if ! pm2 list --no-color | grep -q "mc-daemon.*online"; then
  echo "mc-daemon down — restarting"
  pm2 restart mc-daemon
fi
```

---

## Section 10: Spawning New CEO Agents

When a new idea graduates (score ≥ 85), provision a new CEO agent:

```bash
#!/bin/bash
# /home/neg0/fleet/spawn-ceo.sh <agent-id> <port> <repo-url> <role-description>

AGENT_ID="$1"
PORT="$2"
REPO_URL="$3"
ROLE="$4"

WORKSPACE="/home/neg0/workspaces/workspace-$AGENT_ID"
MC_URL="http://localhost:3000"

# 1. Create workspace and clone repo
mkdir -p "$WORKSPACE"
if [ -n "$REPO_URL" ]; then
  git clone "$REPO_URL" "$WORKSPACE"
fi

# 2. Create CLAUDE.md
cat > "$WORKSPACE/CLAUDE.md" << EOF
# ${AGENT_ID} — ${ROLE}

## Identity
You are **${AGENT_ID}**, the ${ROLE} for Negative Zero.
Agent ID: \`${AGENT_ID}\` | Port: \`${PORT}\`

## Mission Control Integration
MC URL: http://localhost:3000
[... paste full MC Integration block ...]

## Autonomy Rules
[... paste standard rules ...]
EOF

# 3. Register in MC database
curl -s -X POST "$MC_URL/api/agents" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$AGENT_ID\", \"role\": \"$ROLE\", \"workspacePath\": \"$WORKSPACE\", \"status\": \"active\", \"port\": $PORT, \"runtimeMode\": \"claude-code\"}"

# 4. Append to ecosystem.config.js and reload pm2 (automated)
# Uses Node.js to read the current config, insert the new entry after the last
# agentProcess(...) call, write it back, and reload — no manual edits required.
node << NODEEOF
const fs = require('fs');
const configPath = '/home/neg0/fleet/ecosystem.config.js';
let src = fs.readFileSync(configPath, 'utf8');
const agentId = '${AGENT_ID}';
const port = ${PORT};
const newEntry = "    agentProcess('" + agentId + "', " + port + ", { memory: '4G' }),";

// Find the position of the last agentProcess( call and insert after that line
const lastIdx = src.lastIndexOf('agentProcess(');
if (lastIdx === -1) {
  console.error('ERROR: Could not find agentProcess entries in ecosystem.config.js');
  process.exit(1);
}
const lineEnd = src.indexOf('\n', lastIdx);
src = src.slice(0, lineEnd + 1) + newEntry + '\n' + src.slice(lineEnd + 1);
fs.writeFileSync(configPath, src, 'utf8');
console.log('ecosystem.config.js: added agent-' + agentId + ' at port ' + port);
NODEEOF

pm2 reload ecosystem.config.js
pm2 save
echo ""
echo "Agent $AGENT_ID (port $PORT) is now live."
```

---

## Section 11: Observability

### 11.1 Log Files

| File | Contents |
|------|---------|
| `/home/neg0/fleet/logs/{id}-out.log` | pm2 stdout (wrapper logs) |
| `/home/neg0/fleet/logs/{id}-err.log` | pm2 stderr (errors, warnings) |
| `/home/neg0/fleet/logs/{id}.log` | Claude session output (appended by wrapper) |
| `/home/neg0/fleet/logs/mc-daemon-out.log` | Daemon health check logs |
| `/home/neg0/fleet/logs/cron.log` | Cron health check script output |

### 11.2 Log Rotation

Install pm2-logrotate in Phase 1 (before launching agents — a busy agent can fill disk quickly):

```bash
pm2 install pm2-logrotate

# Recommended config (run after install):
pm2 set pm2-logrotate:max_size 100M   # Rotate when file exceeds 100MB
pm2 set pm2-logrotate:retain 14       # Keep 14 rotated files per process
pm2 set pm2-logrotate:compress true   # Gzip rotated logs
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  # Daily at midnight
```

> **Note:** pm2-logrotate runs as a pm2 module (always-on), so it benefits from systemd being enabled (Section 1.2 / 9.2) to survive WSL2 restarts.

### 11.3 Useful Commands

```bash
pm2 list                          # Fleet overview
pm2 monit                         # Live CPU/RAM dashboard
pm2 logs agent-sarge              # Follow one agent's logs
pm2 logs                          # Follow all logs
pm2 restart agent-sarge           # Restart one agent
pm2 restart /agent-/              # Restart all agents (not mc-daemon)
pm2 stop all                      # Stop everything (preserves state)
pm2 describe agent-sarge          # Detailed process info
```

### 11.4 MC Dashboard

The existing heartbeat dashboard (`http://localhost:3000` → Heartbeat section) shows:
- Last heartbeat timestamp per agent
- Recent journal entries
- Open escalations (populated by mc-daemon when agents go silent)
- Orchestrator config and last tick time

---

## Section 12: Implementation Order

```
Phase 1: WSL2 Infrastructure (Day 1 — ~2 hours)
  □ Apply .wslconfig, shutdown and restart WSL2
  □ Install Node 22, pm2, Claude Code CLI in WSL2
  □ Set ANTHROPIC_API_KEY in ~/.env.fleet, verify: claude -p "say hi" --max-turns 1
  □ Configure Windows power settings (no sleep, no hibernate)
  □ Set Windows Update deferral
  □ Enable systemd in WSL2 (/etc/wsl.conf) — required for pm2 startup, native cron, and systemd timers
  □ Install pm2 log rotation: pm2 install pm2-logrotate (configure max_size: 100MB, retain: 14 days)
  □ Add runtimeMode field to Agent schema (Prisma migration) — prerequisite: agents can't register without it
  □ Create /api/heartbeat/status endpoint — prerequisite: mc-daemon fleet health checks depend on this

Phase 2: Workspace Setup (Day 1 — ~1 hour)
  □ Create all workspace directories
  □ Run init-souls.sh to generate CLAUDE.md stubs
  □ Fill in agent-specific soul content (copy from docker/context/ where available)
  □ For CEO agents: git clone product repos into workspaces
  □ Create per-product .env files in CEO workspaces

Phase 3: Fleet Scripts (Day 1-2 — ~3 hours)
  □ Write /home/neg0/fleet/agent-wrapper.js
  □ Write /home/neg0/fleet/mc-daemon.js
  □ Write /home/neg0/fleet/ecosystem.config.js
  □ Manual test of wrapper: AGENT_ID=rocket WORKSPACE_PATH=... node agent-wrapper.js

Phase 4: First Agent End-to-End (Day 2 — ~2 hours)
  □ pm2 start ecosystem.config.js --only mc-daemon,agent-rocket
  □ POST a test message to /api/messages/bus targeting rocket
  □ Verify wrapper detects it, claude session runs, journal entry appears in MC
  □ Verify mc-daemon escalation if rocket goes quiet
  □ Fix any issues before expanding

Phase 5: Full Fleet (Day 2 — ~1 hour)
  □ pm2 start ecosystem.config.js (all processes)
  □ pm2 save
  □ pm2 startup systemd (if systemd available) or configure Task Scheduler

Phase 6: MC Orchestrator Integration (Day 3 — ~2 hours)
  □ Add runtimeMode='claude-code' code path to orchestrator-tick.ts
    (route heartbeat to /api/messages/bus instead of OpenClaw gateway)
  □ UPDATE "Agent" SET "runtimeMode" = 'claude-code' for all fleet agents
    (schema migration and /api/heartbeat/status endpoint done in Phase 1)
  □ Verify heartbeat schedules trigger claude sessions end-to-end
  □ Confirm journal entries appear in MC after each scheduled heartbeat

Phase 7: Auto-Boot Test (Day 3 — ~1 hour)
  □ Shut down Windows fully (not sleep)
  □ Power on
  □ After 3 minutes: verify pm2 list shows all processes online
  □ Verify MC shows fresh heartbeats from agents

Phase 8: Hardening (Week 2)
  □ Set up health-check.sh cron (crontab -e) — systemd required, done in Phase 1
  □ Tune poll interval based on actual heartbeat frequency
  □ Tune memory limits based on observed usage (pm2 monit)
  □ Run fleet for 48 hours, resolve any restart loops
```

---

## Appendix A: Orchestrator Changes for `runtimeMode='claude-code'`

> **Phase 1 prerequisite:** The `runtimeMode` column must exist in the `Agent` schema (Prisma migration) and the `/api/heartbeat/status` endpoint must be live before Phase 3 fleet scripts or Phase 6 orchestrator wiring will work. Complete these in Phase 1 while setting up WSL2 infrastructure.

In `src/lib/orchestrator-tick.ts`, find the section that wakes agents via the OpenClaw gateway and add:

```typescript
// Determine wake method based on agent runtime mode
if (agent.runtimeMode === 'claude-code') {
  // Route heartbeat message to the bus — agent-wrapper polls and picks it up
  await prisma.messageLog.create({
    data: {
      fromId: 'orchestrator',
      toId: schedule.agentId,
      channel: 'message',
      subject: 'Heartbeat',
      body: wakeMessage, // from buildHeartbeatContext()
      status: 'sent',
      metadata: {
        priority: 'medium',
        scheduleId: schedule.id,
        scheduleName: schedule.name,
      },
    },
  });
  return { scheduleId: schedule.id, agentId: schedule.agentId, status: 'ok' };
}

// Existing OpenClaw gateway wake for runtimeMode='gateway' ...
```

Then migrate agent records:
```sql
UPDATE "Agent"
SET "runtimeMode" = 'claude-code'
WHERE id IN (
  'rocket', 'moose', 'sarge', 'captain',
  'prospector', 'designer', 'gardener',
  'refiner', 'accountant', 'architect'
);
```

---

## Appendix B: Troubleshooting

**Claude CLI auth fails in pm2**
pm2 runs in a non-interactive shell — `~/.bashrc` may not be sourced. Set `ANTHROPIC_API_KEY` directly in the `env` block of ecosystem.config.js. Verify: `pm2 env agent-rocket | grep ANTHROPIC`.

**WSL2 loses network after Windows sleep**
Disable sleep entirely via Power Settings (Section 1.4). If it happens anyway, from Windows: `wsl --shutdown`, then restart WSL2.

**pm2 resurrect doesn't restore processes**
Make sure systemd is enabled and `pm2 save` was run after the last `pm2 start`. Check: `cat ~/.pm2/dump.pm2 | jq '.[].name'`.

**Agent wrapper keeps hitting max_restarts**
```bash
tail -50 /home/neg0/fleet/logs/AGENT-err.log
```
Common causes: MC URL unreachable (MC not running), missing `ANTHROPIC_API_KEY`, workspace directory missing.

**Claude session exits with non-zero immediately**
```bash
cd /home/neg0/workspaces/workspace-rocket
claude -p "say hello" --dangerously-skip-permissions --max-turns 1
```
Common causes: quota exceeded, auth error, malformed CLAUDE.md.

**Memory pressure**
```bash
wsl -d Ubuntu-24.04 -- free -h            # Check from Windows
pm2 list --sort memory                     # Which process is largest
sudo sysctl vm.drop_caches=3              # Release page cache
```
Long-term fix: reduce `max_memory_restart` to force earlier recycle, or disable lower-priority agents during peak hours.

**Orchestrator not triggering claude sessions**
Check: `GET /api/orchestrator/tick` — is it enabled? Check agent `runtimeMode` in DB. Check message bus: `GET /api/messages/bus?agentId=sarge&status=sent` — are messages being created but not picked up?
