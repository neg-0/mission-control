# AI Drift Prevention & Knowledge Management

> **Status:** Concept / RFC
> **Author:** Dustin + Antigravity
> **Date:** 2026-02-19
> **Goal:** Prevent autonomous agents from drifting off-target, breaking infrastructure, or losing institutional knowledge.

---

## The Problem

AI drift is the #1 velocity killer in autonomous agent fleets. Real incidents:

| Incident | Root Cause | Impact |
|----------|-----------|--------|
| Agent grabbed wrong DB URL, wiped Mission Control DB | No immutable config; agent inferred connection string | Data loss, hours of recovery |
| Agent can't find API key, creates entirely new repo | No canonical "source of truth" for project metadata | Wasted work, confusion |
| Agent forgets infra is on Railway, deploys to Vercel | No enforced deployment target per project | Broken CI/CD, customer-facing outage |
| Agent overwrites SOUL.md with default template | No file-level protection | Identity loss, needed manual restore from backup |

**Common pattern:** Agent wakes up with limited context → makes a "reasonable" assumption → that assumption is wrong → damage is done before anyone notices.

---

## Solution: Three-Layer Defense

```
┌───────────────────────────────────────┐
│  Layer 1: IMMUTABLE PROJECT MANIFEST  │  ← Can't be changed by agents
│  (project.lock.json)                  │
├───────────────────────────────────────┤
│  Layer 2: GUARDRAILS IN AGENT DOCS   │  ← Agent reads on every boot
│  (SOUL.md, HEARTBEAT.md)             │
├───────────────────────────────────────┤
│  Layer 3: RUNTIME VALIDATION         │  ← MC validates before execution
│  (pre-deploy hooks, config checks)   │
└───────────────────────────────────────┘
```

---

## Layer 1: Immutable Project Manifest

Every CEO's workspace gets a `project.lock.json` — the single source of truth for everything that **must not change** without human approval.

```jsonc
// workspace-sarge/project.lock.json
{
  "$schema": "https://control.neg0.cloud/schemas/project-lock.json",
  "version": 1,
  "locked_by": "dustin",
  "locked_at": "2026-02-19T00:00:00Z",

  "product": {
    "name": "Chocks",
    "domain": "chocks.ai",
    "repo": "https://github.com/neg-0/chocks",
    "description": "Veteran transition platform — SkillBridge matching and career mapping"
  },

  "infrastructure": {
    "hosting": "railway",
    "railway_project_id": "abc123",
    "railway_environment": "production",
    "deploy_target": "railway",       // NEVER deploy elsewhere
    "allowed_deploy_commands": [
      "railway up",
      "git push origin main"          // Railway auto-deploys from main
    ],
    "forbidden_deploy_commands": [
      "vercel deploy",
      "vercel --prod",
      "netlify deploy",
      "fly deploy"
    ]
  },

  "tech_stack": {
    "runtime": "node",
    "framework": "express + react",
    "database": {
      "provider": "railway-postgres",
      "connection_env_var": "DATABASE_URL",  // Use THIS, never construct manually
      "migration_tool": "knex"
    },
    "orm": "knex",
    "test_runner": "vitest"
  },

  "credentials": {
    // Not the actual values — just WHERE to find them
    "DATABASE_URL": { "source": "railway", "note": "Auto-injected by Railway" },
    "RAILWAY_TOKEN": { "source": "mc railway-token --agent sarge" },
    "OPENAI_API_KEY": { "source": "env", "note": "Set in .env, do NOT regenerate" }
  },

  "guardrails": {
    "protected_files": [
      "SOUL.md",
      "IDENTITY.md",
      "project.lock.json"
    ],
    "protected_branches": ["main", "production"],
    "require_pr_for": ["main"],
    "max_files_per_commit": 20,
    "forbidden_operations": [
      "DROP DATABASE",
      "DROP TABLE",
      "truncate",
      "rm -rf /",
      "openclaw config"         // Use mc config-manager skill instead
    ]
  }
}
```

## Enforcement: How to "Hard Lock" the Manifest

Agents are instructed via `SOUL.md` to read `project.lock.json` on every boot. But **trust-but-verify** isn't enough. A hallucinating agent with root/write access to its workspace can overwrite the file.

### The Docker Read-Only Mount Strategy

Because each CEO pod runs as a Docker container, we can enforce File System level locks from the host VPS:

1. **Host-Owned, Agent-Read:** 
   The `project.lock.json` file lives on the host VPS, owned by `root`. The OpenClaw container runs as an unprivileged user (e.g., `UID 1000`).
2. **Read-Only Volume Mount:**
   The file is mounted into the container as read-only:
   ```bash
   docker run -d \
     -v /opt/neg0/sarge/workspace:/home/node/.openclaw \
     -v /opt/neg0/sarge/project.lock.json:/home/node/.openclaw/workspace-sarge/project.lock.json:ro \
     openclaw-base:latest
   ```
3. **Impenetrable:**
   Even if the agent runs `echo "{}" > project.lock.json`, the Linux kernel will block it (`Read-only file system`). The agent *cannot* bypass this lock without breaking out of the container. 
4. **Mission Control Updates:**
   When you need to change the deploy target, Mission Control (running on the host or via SSH) modifies the locked file. The agent sees the changes immediately, but can never edit them.

## Layer 2: Agent Boot Context

Every agent reads its docs on session start. These docs must contain **explicit, unambiguous** instructions. The pattern:

### SOUL.md — Identity + Principles

```markdown
## ⚠️ Critical Rules (Read Every Session)

1. **ALWAYS read `project.lock.json` before any infrastructure action**
2. **NEVER deploy to any platform other than Railway**
3. **NEVER construct database URLs manually — use $DATABASE_URL**
4. **NEVER modify SOUL.md, IDENTITY.md, or project.lock.json**
5. **ALWAYS use `mc railway-token` to get tokens — never create new ones**
6. **When stuck, journal it (`mc journal`) and move to next task. Do NOT improvise.**
```

### HEARTBEAT.md — Current State Snapshot

```markdown
## Current Sprint
- **Goal:** Launch SkillBridge matching v2
- **Blockers:** None
- **Deploy target:** Railway (project: abc123)
- **Branch:** feat/skillbridge-v2

## Known Gotchas
- DATABASE_URL is injected by Railway, not in .env file
- Run `mc railway-token` if token expires (1hr TTL)
- Tests must pass before PR to main: `npm test`
```

### KEY: What Goes Where

| Info Type | File | Mutable By Agent? |
|-----------|------|-------------------|
| Agent personality, principles | `SOUL.md` | No (protected) |
| Agent name, role, emoji | `IDENTITY.md` | No (protected) |
| Current sprint, blockers, state | `HEARTBEAT.md` | Yes (updated each heartbeat) |
| Product, domain, infra, stack | `project.lock.json` | No (human-only) |
| Daily work log | `mc journal` | Yes |
| Goals and tasks | `mc goal` / `mc task` | Yes (within assigned scope) |

---

## Layer 3: Runtime Validation

### Pre-Deploy Hook (Mission Control)

```typescript
// MC validates before any deployment
async function validateDeploy(agentId: string, command: string): Promise<boolean> {
  const lock = await readProjectLock(agentId);

  // Check deploy target matches
  if (!lock.infrastructure.allowed_deploy_commands.includes(command)) {
    await notifyHuman(`⚠️ ${agentId} tried to run: ${command}`);
    await notifyHuman(`Expected one of: ${lock.infrastructure.allowed_deploy_commands}`);
    return false;
  }

  // Check forbidden operations
  for (const forbidden of lock.guardrails.forbidden_operations) {
    if (command.includes(forbidden)) {
      await notifyHuman(`🚨 ${agentId} tried forbidden operation: ${forbidden}`);
      return false;
    }
  }

  return true;
}
```

### Gardener Audit (Periodic)

Gardener runs integrity checks on every heartbeat:

```markdown
## Gardener Audit Checklist

- [ ] All CEOs have a valid `project.lock.json`
- [ ] No protected files modified since last audit (git diff check)
- [ ] Deploy targets match lock file (no Vercel deployments from Railway projects)
- [ ] Database URLs match lock file expectations
- [ ] No orphaned repos or duplicate projects
- [ ] All Railway services healthy
- [ ] SOUL.md / IDENTITY.md match canonical versions
```

---

## Knowledge Management & Shared Memory Across CEOs

### The Problem

CEO #1 discovers a best practice (e.g., "always use `--force-recreate` when Railway deploy stalls"). How does CEO #47 learn this? If they live in isolated Docker containers, they can't simply read each other's local `~/.openclaw/knowledge` markdown files without building a fragile, latency-heavy shared network drive (NFS/SSHFS).

### Solution: Network-First Memory

Move shared knowledge off the local filesystem and into **services**:

#### 1. Mission Control Knowledge API (For Rules & Templates)
Instead of local markdown files, agents pull canonical best practices from MC on boot:
```bash
# Agent runs this via a startup script or reads it via MC CLI
mc knowledge get best-practices/railway-deployment
```
Mission Control stores this in a lightweight SQLite/Postgres DB. When Gardener learns a new rule, it runs `mc knowledge set ...`, making it instantly available to all 50+ isolated CEO containers without a single file sync.

#### 2. Vector DB (For Context & Past Solutions)
When a CEO hits a bizarre error, they shouldn't just Google it—they should ask the fleet.
- Deploy a self-hosted Vector DB (e.g., Qdrant, Milvus, or `pgvector` inside MC's database).
- **Write:** When a CEO solves a hard bug, they run `mc memory record "Solved a Knex migration lock error by doing X"`. MC embeds this and saves it.
- **Read:** When another CEO hits a Knex error, their first step in `SOUL.md` should dictate: "Search fleet memory for similar bugs before acting." (`mc memory search "Knex migration lock"`).

#### 3. Ephemeral Cross-Talk (Discord)
You already have this. Discord is the shared message bus. If a CEO needs something the Vector DB doesn't know, they can post to a shared `#general-ceo` channel: *"Has anyone seen an EACCES error on Railway Redis volumes?"*

### Knowledge Propagation Loop

1. **Incident Occurs:** Agent makes a mistake.
2. **Post-Mortem:** Agent (or human) writes an incident log.
3. **Extraction:** Gardener agent reads the log, extracts the rule, and pushes it to Mission Control (`mc knowledge set`).
4. **Distribution:** All other CEOs pull the updated rule on their next heartbeat or boot. No file syncing required.

---

## Implementation Priority

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 🔴 P0 | Create `project.lock.json` for each active CEO | 1 hour | Prevents repeat incidents |
| 🔴 P0 | Add "Critical Rules" section to each CEO's SOUL.md | 30 min | Immediate behavior change |
| 🟡 P1 | Gardener audit checklist in heartbeat | 2 hours | Catches drift before damage |
| 🟡 P1 | Knowledge base directory structure | 1 hour | Cross-CEO learning |
| 🟢 P2 | Pre-deploy validation hook in MC | 4 hours | Runtime enforcement |
| 🟢 P2 | Protected file git hooks | 2 hours | Prevents accidental overwrites |

> [!CAUTION]
> **P0 items should be done immediately.** The `project.lock.json` pattern alone would have prevented both the DB wipe and the wrong-platform deploy incidents.

---

*See also:*
- [fleet-architecture.md](./fleet-architecture.md) — CEO pod model
- [infrastructure-scaling.md](./infrastructure-scaling.md) — VPS vs Railway, cost modeling
