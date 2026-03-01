# 🚀 Mission Control

Real-time operations dashboard for [OpenClaw](https://github.com/neg-0/openclaw). Monitors PRs, goals, pipelines, costs, sub-agents, and workspace files — all connected to the gateway via a server-side SSE bridge.

## Features

- **PR Queue** — Live GitHub PR status with CI, reviews, and ownership
- **Goals Tracker** — Parses and displays `GOALS.md` objectives
- **Tasks & Pipelines** — Orchestrate and track multi-step agent workflows
- **Sub-Agents Panel** — Monitor running OpenClaw agent sessions
- **File Browser** — Browse and search workspace markdown files
- **Gateway Stream** — Real-time health and event feed from the OpenClaw gateway
- **Escalations & Checkpoints** — Human-in-the-loop approval flow
- **Cost Tracking** — Monitor agent spend and resource usage
- **Kick to Rocket** — Send items to Rocket for action via OpenClaw hooks

## Architecture

```
Browser ──(SSE)──► /api/stream ──(WebSocket)──► OpenClaw Gateway
```

The browser connects to `/api/stream` (a Next.js API route) via Server-Sent Events. This route maintains a WebSocket connection to the OpenClaw gateway, handles the `connect.challenge` handshake, and forwards events to the browser as SSE.

## Setup

```bash
git clone https://github.com/neg-0/mission-control.git
cd mission-control/ui
npm install
npx prisma generate
```

### Environment

Copy `.env.example` → `.env` and fill in the values:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENCLAW_GATEWAY_URL` | ✅ | Gateway URL (e.g. `http://localhost:18789`) |
| `OPENCLAW_HOOKS_TOKEN` | ✅ | Gateway hooks auth token |
| `OPENCLAW_WORKSPACE_ROOT` | ✅ | Workspace path for the file browser |
| `GITHUB_TOKEN` | Optional | GitHub PAT for PR fetching |

### Development

```bash
npm run dev          # http://localhost:3000
npm run build        # Production build
npm run test         # Run tests
npm run lint         # ESLint
```

## Deployment

Mission Control runs as a systemd user service alongside the OpenClaw gateway.

```bash
# Service management
systemctl --user status mission-control
systemctl --user restart mission-control
journalctl --user -u mission-control -f
```

The service is configured with `BindsTo=openclaw-gateway.service` so it restarts automatically when the gateway restarts.

## License

Private — Negative Zero Inc.
