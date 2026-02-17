# Railway Token System

Mission Control manages Railway authentication for the entire AI Army fleet. Agents never need to authenticate with Railway directly — tokens are generated, refreshed, and distributed automatically.

## Token Types

| Token | Env Var | Scope | Lifetime |
|-------|---------|-------|----------|
| **Account token** | `RAILWAY_API_TOKEN` | Full Railway API access (all projects) | 1 hour (auto-refreshed) |
| **Refresh token** | `RAILWAY_REFRESH_TOKEN` | Used to obtain new account tokens | Long-lived (rotated on each use) |
| **Project token** | `RAILWAY_TOKEN` | Scoped to one project + environment | Static (regenerated on refresh) |

**Account tokens** are shared with all agents for general Railway API queries. **Project tokens** are scoped to the specific Railway project each agent owns — safer for deployments since they can't affect other projects.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                      Mission Control                            │
│                                                                 │
│  1. OAuth → Railway (admin clicks Reconnect in Settings)        │
│  2. Token exchange → access_token + refresh_token               │
│  3. Auto-discovery: match Railway projects → MC projects        │
│  4. Generate project tokens via projectTokenCreate mutation      │
│  5. Distribute to all 12 agent workspace .env files             │
│  6. Cron refreshes account token every 45 min                   │
│  7. On each refresh, regenerate + redistribute project tokens   │
└─────────────────────────────────────────────────────────────────┘
```

### Token Flow

1. **Admin connects Railway** — Settings → Integrations → Railway → Connect/Reconnect
2. **OAuth callback** exchanges the auth code for tokens via PKCE
3. **Auto-discovery** queries all Railway workspaces, fetches their projects, and fuzzy-matches them to MC projects by name (case-insensitive, ignoring hyphens/spaces)
4. **Distribution** writes `RAILWAY_API_TOKEN` (account) and `RAILWAY_TOKEN` (project-scoped) to each agent's `~/.openclaw/workspace-{agent}/.env`
5. **Cron** (`*/45 * * * *`) refreshes the account token before it expires and redistributes everything

### Auto-Discovery Matching

Railway projects are matched to MC projects by normalized name:

| Railway Project | MC Project | Agent | Match? |
|----------------|------------|-------|--------|
| Anti-CPQ | anti-cpq | closer | ✅ |
| Chocks | chocks | sarge | ✅ |
| ShipLog | shiplog | captain | ✅ |
| ArmourMail | armourmail | warden | ✅ |
| CompIQ | *(no MC project)* | — | ❌ |

Unmatched projects can be linked manually via `PATCH /api/projects/:id/railway`.

## For Agents

### Getting Your Project Token

Your `RAILWAY_TOKEN` is automatically written to your workspace `.env` by Mission Control. If you need a fresh one:

```bash
mc railway-token
```

This calls MC's self-service API, generates a new project token, and writes it to your `.env`.

### Checking Railway Status

```bash
mc railway-status
```

Shows whether Railway is connected, token health, and last refresh time.

### Triggering Discovery

If a new Railway project was created and needs linking:

```bash
mc railway-discover --generate
```

### Which Token to Use

| Task | Use |
|------|-----|
| Deploy your project | `RAILWAY_TOKEN` (project-scoped) |
| Query Railway API (list services, check logs) | `RAILWAY_API_TOKEN` (account-level) |
| Create/delete projects | `RAILWAY_API_TOKEN` (account-level) |

### Example: Deploy with Railway CLI

```bash
# RAILWAY_TOKEN is already in your .env
railway up
```

### Example: Query Railway API

```bash
curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
  -d '{"query":"{ me { name } }"}'
```

## API Reference

### Self-Service Token

```
GET /api/tokens/railway?agentId=captain
```

Returns a fresh project token for the agent. Writes it to the agent's `.env` by default. Add `&writeEnv=false` to skip.

### Auto-Discovery

```
POST /api/tokens/railway
Content-Type: application/json
{"generateTokens": true}
```

Discovers Railway projects, links them to MC projects, and optionally generates tokens.

### Manual Linking

```
PATCH /api/projects/:projectId/railway
Content-Type: application/json
{"railwayProjectId": "uuid", "railwayEnvironmentId": "uuid"}
```

### Health Check

```
GET /api/auth/railway/status
```

Returns: `connected`, `hasRefreshToken`, `lastRefreshAt`, `tokenAgeMinutes`, `healthy`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `RAILWAY_TOKEN` missing from `.env` | Run `mc railway-token` |
| `RAILWAY_API_TOKEN` expired | Click "Refresh Now" in Settings or wait for cron |
| `invalid_grant` error | Admin must click "Reconnect" in Settings (refresh token is stale) |
| New project not auto-linked | Run `mc railway-discover --generate` |
| `mc railway-token` says "No Railway-linked project" | Link it: `PATCH /api/projects/:id/railway` with Railway UUIDs |

## Architecture

```
src/lib/token-utils.ts          — Core: token generation, distribution, discovery
src/app/api/tokens/railway/     — Self-service API (GET token, POST discover)
src/app/api/cron/refresh-tokens — Cron: refresh + redistribute every 45 min
src/app/api/auth/railway/       — OAuth flow (login, callback, status)
src/app/api/projects/[id]/railway — Manual project linking
mc.py                           — CLI commands (railway-token, railway-discover, railway-status)
```
