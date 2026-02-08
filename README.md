# 🚀 Mission Control

Real-time operations dashboard for OpenClaw. Monitors PRs, goals, sub-agents, and workspace files — all connected to the gateway via a server-side SSE bridge.

## Features

- **PR Queue** — Live GitHub PR status with CI, reviews, and ownership
- **Goals Tracker** — Parses and displays `GOALS.md` objectives
- **Sub-Agents Panel** — Monitor running OpenClaw agent sessions
- **File Browser** — Browse workspace markdown files
- **Gateway Stream** — Real-time health and event feed from the OpenClaw gateway
- **Kick to Rocket** — Send items to Rocket for action via OpenClaw hooks

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Browser                             │
│  ┌─────────────┐   EventSource    ┌───────────────────┐  │
│  │  React App  │◄────(SSE)───────►│  /api/stream      │  │
│  └─────────────┘                  │  (SSE Bridge)     │  │
└──────────────────────────────────────────────────────────┘
                                           │
                                      WebSocket
                                      ws://127.0.0.1:18789
                                           │
                                    ┌──────▼──────┐
                                    │   OpenClaw  │
                                    │   Gateway   │
                                    └─────────────┘
```

The browser connects to `/api/stream` (a Next.js API route) via Server-Sent Events. This route runs a WebSocket client that connects to the OpenClaw gateway on loopback, handles the `connect.challenge` handshake, and forwards events to the browser as SSE.

## Project Structure

```
src/
├── app/
│   ├── page.tsx                 # Main dashboard page
│   ├── layout.tsx               # Root layout
│   └── api/
│       ├── stream/route.ts      # SSE bridge → gateway WebSocket
│       ├── github/prs/route.ts  # GitHub PR fetching
│       ├── sessions/route.ts    # OpenClaw session listing
│       ├── kick/route.ts        # Kick-to-Rocket action
│       └── files/               # Workspace file browsing
│           ├── route.ts
│           ├── read/route.ts
│           └── tree/route.ts
├── components/
│   ├── FileBrowser.tsx          # Workspace file browser
│   ├── GoalsTracker.tsx         # GOALS.md viewer
│   ├── PRQueue.tsx              # GitHub PR list
│   └── SubAgentsPanel.tsx       # Agent session monitor
├── hooks/
│   └── useGatewayStream.ts      # React hook for SSE connection
└── lib/
    ├── gateway-client.ts        # Node.js WebSocket client
    ├── alerts.ts                # Alert computation
    ├── goals.ts                 # GOALS.md parser
    ├── files.ts                 # File utilities
    ├── mock-data.ts             # Dev mock data
    └── utils.ts                 # cn() and helpers
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| Real-time | SSE bridge → OpenClaw Gateway WebSocket |
| Drag & Drop | @dnd-kit |
| Markdown | react-markdown |

## Setup

### Clone

```bash
git clone https://github.com/neg-0/mission-control.git
cd mission-control
npm install
```

### Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENCLAW_GATEWAY_URL` | ✅ | Gateway WebSocket URL (e.g. `ws://127.0.0.1:18789`) |
| `OPENCLAW_GATEWAY_TOKEN` | ✅ | Gateway auth token (from `openclaw gateway status`) |
| `OPENCLAW_WORKSPACE_ROOT` | ✅ | Workspace path for file browser |
| `GITHUB_TOKEN` | Optional | GitHub PAT for PR fetching |

### Development

```bash
npm run dev        # Start dev server on http://localhost:3000
npm run build      # Production build
npm run start      # Start production server
npm run lint       # Run ESLint
```

## Deployment (VPS / Systemd)

Mission Control runs as a systemd user service alongside the OpenClaw gateway.

### Service File

Located at `~/.config/systemd/user/mission-control.service`:

```ini
[Unit]
Description=Mission Control UI
After=network-online.target openclaw-gateway.service
BindsTo=openclaw-gateway.service

[Service]
Type=simple
WorkingDirectory=/path/to/mission-control/ui
ExecStart=/path/to/node /path/to/npm run dev -- --port 3000
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Key behaviors:
- **`BindsTo=openclaw-gateway.service`** — restarts when the gateway restarts
- **`Restart=always`** — auto-restarts on crash (5s delay)
- **Enabled at boot** — starts automatically on login

### Service Commands

```bash
systemctl --user status mission-control     # Check status
systemctl --user restart mission-control    # Restart
systemctl --user stop mission-control       # Stop
journalctl --user -u mission-control -f     # Tail logs
```

### Tailscale (Remote Access)

Both the gateway and mission control are exposed via Tailscale Serve:

```bash
# Mission Control on port 443 (default HTTPS)
tailscale serve --bg --yes http://localhost:3000

# Gateway on port 8443
tailscale serve --bg --yes --https 8443 http://localhost:18789
```

Access URLs (tailnet only):
- **Mission Control**: `https://<tailnet-hostname>/`
- **Gateway Dashboard**: `https://<tailnet-hostname>:8443/`

## License

Private — Negative Zero Inc.
