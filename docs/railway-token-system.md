# Railway Token System

Mission Control manages Railway authentication for the entire AI Army fleet. Agents never need to authenticate with Railway directly — tokens are generated, refreshed, and distributed automatically.

> [!CAUTION]
> **Before editing any Railway token code**, read the [Critical Rules](#critical-rules) section below. Past bugs were caused by faulty assumptions about how Railway's OAuth tokens work.

---

## Railway OAuth Behavior

> Source: [Railway Login & Tokens docs](https://docs.railway.com/integrations/oauth/login-and-tokens)

### Token Lifecycle

| Token | Env Var | Lifetime | On Refresh |
|-------|---------|----------|------------|
| **Access token** | `RAILWAY_API_TOKEN` | **1 hour** | Old token remains valid until expiry. New refreshes do NOT invalidate previous access tokens. |
| **Refresh token** | `RAILWAY_REFRESH_TOKEN` | **1 year** | **Rotated**: "may initially contain the same value, but will eventually return a new token." Always store the latest. |
| **Project token** | `RAILWAY_TOKEN` | Static | Regenerated on each cron cycle via `projectTokenCreate` mutation. |

### What Railway Returns on Refresh

```
POST https://backboard.railway.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=<current_refresh_token>
&client_id=<client_id>
&client_secret=<client_secret>

→ 200 OK
{
  "access_token": "new-access-token",    ← valid for 1 hour
  "refresh_token": "same-or-rotated",    ← ALWAYS store this
  "expires_in": 3600,
  "token_type": "Bearer",
  "id_token": "...",
  "scope": "openid email profile offline_access workspace:admin project:member"
}
```

### Key Behaviors

- **Access tokens are NOT invalidated** by new refreshes — they stay valid until their 1-hour TTL expires
- **Refresh tokens ARE rotated** — Railway may return the same value initially but will eventually rotate it
- **Using an old rotated refresh token will FAIL** and require full re-authentication (admin must click Reconnect in Settings)
- **Max 100 refresh tokens per user** — oldest are auto-revoked (our hourly cron is well within this limit)

---

## Critical Rules

> [!IMPORTANT]
> These rules exist because of real bugs we discovered. Do not remove or weaken them.

### 1. Single Writer for OAuth Tokens

Only the **cron endpoint** (`/api/cron/refresh-tokens`) should call Railway's `/oauth/token`. The OAuth callback (`/api/auth/railway/callback`) is the only exception — it does the initial code→token exchange.

**Why**: Each call to `/oauth/token` may rotate the refresh token. If two processes refresh simultaneously, one will write a stale refresh token to `.env`, and the next refresh will fail with `invalid_grant`.

### 2. Read from `.env`, Not `process.env`

All Railway env var reads at runtime **must** use `getFreshEnvVar()` or its wrappers (`getFreshAccountToken()`, `getFreshRefreshToken()`).

**Why**: `process.env` is loaded once at server start. If the cron refreshes the token and writes it to `.env`, but the server restarts or crash-loops, `process.env` holds the old value. Reading from `.env` always gets the latest.

### 3. Always Store the Latest Refresh Token

`persistMCTokens()` writes both access and refresh tokens to **both** `.env` (disk) and `process.env` (memory). This dual-write pattern ensures:
- `.env` — survives process restarts (source of truth)
- `process.env` — available immediately without file I/O

**Never skip writing the refresh token**, even if it looks the same as the old one. Railway's rotation is eventual, not immediate.

### 4. No Manual OAuth Calls

Never manually `curl` Railway's `/oauth/token` endpoint. It will:
1. Generate a new access token (fine)
2. Potentially rotate the refresh token (dangerous — the new refresh token won't be stored by Mission Control)
3. Cause the next cron refresh to fail with `invalid_grant`

If you need to test, use the cron endpoint: `curl http://localhost:3000/api/cron/refresh-tokens`

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Mission Control                              │
│                                                                      │
│  Settings UI ─→ /api/auth/railway/login  ─→ Railway OAuth consent    │
│                 /api/auth/railway/callback ←─ code exchange (PKCE)   │
│                       │                                              │
│                       ▼                                              │
│              persistMCTokens() ─→ .env + process.env                 │
│              discoverAndLinkRailwayProjects()                        │
│              distributeProjectTokens()                               │
│                       │                                              │
│  ┌────────────────────┴─────────────────────────┐                    │
│  │  Cron (45 * * * *)                           │                    │
│  │  /api/cron/refresh-tokens                    │                    │
│  │                                              │                    │
│  │  1. getFreshRefreshToken() ← reads .env      │                    │
│  │  2. POST /oauth/token                        │                    │
│  │  3. persistMCTokens()                        │                    │
│  │  4. distributeTokenToAgents() → 12 agents    │                    │
│  │  5. distributeProjectTokens() → 4 projects   │                    │
│  └──────────────────────────────────────────────┘                    │
│                                                                      │
│  Status: /api/auth/railway/status ← validates via { me { name } }    │
│  Self-service: /api/tokens/railway ← agents request their own token  │
└──────────────────────────────────────────────────────────────────────┘
```

### File Map

| File | Role | Reads Token From |
|------|------|------------------|
| `src/lib/token-utils.ts` | Core utilities: env read/write, token gen, distribution, discovery | `.env` via `getFreshEnvVar()` |
| `src/app/api/cron/refresh-tokens/route.ts` | Hourly refresh + distribution (SOLE WRITER) | `.env` via `getFreshRefreshToken()` |
| `src/app/api/auth/railway/callback/route.ts` | OAuth code→token exchange (initial auth only) | Request params + Railway API |
| `src/app/api/auth/railway/status/route.ts` | Health check with live API validation | `.env` via `getFreshEnvVar()` |
| `src/app/api/tokens/railway/route.ts` | Self-service token API for agents | `.env` via `getFreshAccountToken()` |
| `src/app/api/projects/[id]/railway/route.ts` | Manual project linking (PATCH) | N/A (writes to DB) |
| `mc.py` (CLI) | `mc railway-token`, `mc railway-discover`, `mc railway-status` | Calls MC API endpoints |

---

## Token Types

| Token | Env Var | Scope | Set By |
|-------|---------|-------|--------|
| **Account token** | `RAILWAY_API_TOKEN` | Full Railway API access (all projects) | Cron refresh, OAuth callback |
| **Refresh token** | `RAILWAY_REFRESH_TOKEN` | Obtain new account tokens | Cron refresh, OAuth callback |
| **Project token** | `RAILWAY_TOKEN` | Scoped to one project + environment | Cron, self-service API |

**Account tokens** are shared with all agents for general Railway API queries. **Project tokens** are scoped to the specific Railway project each agent owns — safer for deployments.

---

## Environment Variables Reference

| Variable | Location | Set By | Read By | Notes |
|----------|----------|--------|---------|-------|
| `RAILWAY_API_TOKEN` | MC `.env` + all agent `.env` | Cron, callback | All API routes, agents | 1h TTL, auto-refreshed |
| `RAILWAY_REFRESH_TOKEN` | MC `.env` only | Cron, callback | Cron only | Rotated by Railway; 1-year TTL |
| `RAILWAY_CLIENT_ID` | MC `.env` only | Admin (manual) | Cron, callback, login | From Railway OAuth app settings |
| `RAILWAY_CLIENT_SECRET` | MC `.env` only | Admin (manual) | Cron, callback | From Railway OAuth app settings |
| `RAILWAY_LAST_REFRESH_AT` | MC `.env` only | Cron, callback | Status endpoint | ISO 8601 timestamp |
| `RAILWAY_TOKEN` | Agent `.env` only | Cron, self-service | Agents (Railway CLI) | Per-project scoped token |
| `MISSION_CONTROL_URL` | MC `.env` only | Admin (manual) | Callback | Used to build redirect URI |

---

## Auto-Discovery Matching

Railway projects are matched to MC projects by normalized name (case-insensitive, ignoring hyphens/underscores/spaces):

| Railway Project | MC Project | Agent | Match? |
|----------------|------------|-------|--------|
| Anti-CPQ | anti-cpq | closer | ✅ |
| Chocks | chocks | sarge | ✅ |
| ShipLog | shiplog | captain | ✅ |
| ArmourMail | armourmail | warden | ✅ |
| CompIQ | *(no MC project)* | — | ❌ |

Unmatched projects can be linked manually via `PATCH /api/projects/:id/railway`.

---

## For Agents

### Getting Your Project Token

Your `RAILWAY_TOKEN` is automatically written to your workspace `.env` by Mission Control. If you need a fresh one:

```bash
mc railway-token
```

### Checking Railway Status

```bash
mc railway-status
```

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

---

## API Reference

### Self-Service Token

```
GET /api/tokens/railway?agentId=captain[&writeEnv=false]
```

Returns a fresh project token for the agent. Writes it to the agent's `.env` by default.

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

Returns: `connected`, `hasRefreshToken`, `lastRefreshAt`, `tokenAgeMinutes`, `tokenValid`, `healthy`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `tokenValid: false` after restart | Service crash-loop lost `process.env` state | Fixed by reading from `.env` via `getFreshEnvVar()` |
| `invalid_grant` error | Refresh token was rotated by an external call | Admin must click "Reconnect" in Settings |
| `RAILWAY_TOKEN` missing from agent `.env` | Agent not linked or cron hasn't run | Run `mc railway-token` or `mc railway-discover --generate` |
| `RAILWAY_API_TOKEN` expired | Cron didn't run or service was down | Click "Refresh Now" in Settings or wait for next cron |
| `Not Authorized` from Railway API | Token is stale (>1h old) and cron missed | Trigger manual refresh: `curl http://localhost:3000/api/cron/refresh-tokens` |
| New project not auto-linked | Name doesn't fuzzy-match | Link manually: `PATCH /api/projects/:id/railway` |
| `mc railway-token` says "No Railway-linked project" | Project not linked to Railway | Run `mc railway-discover` first, or link manually |
