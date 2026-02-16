# Mission Control API Reference

## Authentication
- **GET** `/api/auth/railway/login` - Initiate Railway OAuth flow.
- **GET** `/api/auth/railway/callback` - OAuth callback handler.

## Orchestration & Heartbeat
- **GET** `/api/heartbeat/status` - Global system status (tick timer, active agents).
- **POST** `/api/orchestrator/tick` - Force a manual heartbeat tick.
- **GET/PATCH** `/api/orchestrator/config` - Manage ticker settings (interval, concurrency).
- **GET** `/api/orchestrator/logs` - Fetch agent activity logs (tasks + messages).
- **GET** `/api/heartbeat-preview` - Preview next scheduled wakes.

## Agents & Tasks
- **GET/POST** `/api/tasks` - List or create tasks.
- **GET/POST** `/api/journal` - **[NEW]** Agent persistent memory log (did/next/status).
- **GET** `/api/schedules` - List active cron/heartbeat schedules.
- **POST** `/api/schedules` - Create new schedule.
- **POST** `/api/kick` - Manually wake an agent immediately.

## Projects & Ideas
- **GET/POST** `/api/projects` - Manage projects.
- **GET/PATCH** `/api/projects/[id]` - Project details.
- **GET/POST** `/api/ideas` - Idea refinery backlog.
- **GET/PATCH** `/api/ideas/[id]` - Idea details (metrics, status).
- **POST** `/api/checkpoints` - Resolve SDLC gates/checkpoints.

## Infrastructure & Metrics
- **GET** `/api/resources` - Tracked infra resources (DBs, slots).
- **GET** `/api/metrics/sync` - Sync external metrics (Stripe, etc).
- **GET** `/api/costs` - Cost breakdown.
- **GET** `/api/gateway-status` - Connection status to OpenClaw Gateway.
- **GET** `/api/cron/refresh-tokens` - **[CRITICAL]** Refresh Railway OAuth tokens.

## File System
- **GET** `/api/files/tree` - List workspace files.
- **POST** `/api/files/read` - Read file content.
- **POST** `/api/files/write` - Write file content.

## Integrations
- **GET** `/api/github/prs` - List open PRs across repos.
- **POST** `/api/webhooks/refinery/[ideaId]` - Webhook receiver for external signals.
- **POST** `/api/messages` - Log inter-agent communications.
- **POST** `/api/escalations` - Escalate blockers to human operator.
