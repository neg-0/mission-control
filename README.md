# 🚀 Mission Control

Real-time dashboard for visibility into our work. Built for Rocket + Dustin.

## Features

- **PR Queue** — Live GitHub PR status with CI, reviews, ownership
- **Goals Tracker** — Parse and display GOALS.md objectives  
- **Sub-Agents Panel** — Monitor running OpenClaw sub-agents
- **File Browser** — Browse workspace markdown files
- **Kick to Rocket** — Send items to Rocket for action via OpenClaw hooks

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Required:
- `GITHUB_TOKEN` — Personal access token for PR fetching
- `OPENCLAW_GATEWAY_URL` — OpenClaw gateway URL (e.g., `http://localhost:18789`)
- `OPENCLAW_HOOKS_TOKEN` — Token for OpenClaw hooks API

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS
- **Icons:** Lucide React
- **Real-time:** OpenClaw Gateway WebSocket

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import in Vercel dashboard
3. Add environment variables
4. Deploy

### Railway

```bash
railway init
railway up
```

## Architecture

```
┌─────────────────────┐
│   Mission Control   │
│   (Next.js App)     │
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
┌─────────┐ ┌─────────────┐
│ GitHub  │ │  OpenClaw   │
│   API   │ │   Gateway   │
└─────────┘ └─────────────┘
```

## License

Private — Negative Zero Inc.
