# Infrastructure Scaling Strategy

> **Status:** Concept / RFC
> **Author:** Dustin + Antigravity
> **Date:** 2026-02-19
> **Goal:** Determine how to host and scale from 1 to 1,000 OpenClaw instances.

---

## Current State

| Resource | Spec |
|----------|------|
| **VPS** | Hostinger KVM 2 — 2 vCPU, 8GB RAM, 100GB disk |
| **Cost** | ~$80/yr (first year promo) |
| **Running** | 1 OpenClaw gateway, 13 agents, Chrome, Mission Control, Caddy, Tailscale |
| **Projects hosted on** | Railway (ShipLog, Chocks, GlassWall, etc.) |

---

## Options Comparison

### Option A: Scale VPS Vertically

Add more agents to the same VPS, upgrade plan when needed.

| Pros | Cons |
|------|------|
| Simplest. No architecture change | Single point of failure |
| Cheapest at small scale ($80/yr) | 2 vCPU / 8GB RAM ceiling per tier |
| Everything on one machine = low latency | Can't isolate CEO pods |
| | Browser + 20 agents = RAM pressure |

**Scaling ceiling:** ~15-20 agents before needing to upgrade. At $240/yr for 4 vCPU/16GB, still very cheap. But fundamentally doesn't solve isolation.

**Cost projection:**

| Agents | VPS Tier | Approx Cost/yr |
|--------|----------|-----------------|
| 13 | KVM 2 (2 vCPU, 8GB) | $80 |
| 20 | KVM 4 (4 vCPU, 16GB) | $240 |
| 40 | KVM 8 (8 vCPU, 32GB) | $480 |
| 100+ | Multiple VPS | $1,000+ |

---

### Option B: Railway Containers

Run each OpenClaw instance as a Railway service in a single project.

| Pros | Cons |
|------|------|
| Pay-per-use (sleep when idle) | Agents aren't always idle — heartbeats keep them warm |
| Easy horizontal scaling | $5/mo minimum per service + usage |
| Programmatic via Railway API | 10 CEO pods = ~$50-150/mo minimum just for containers |
| Already using Railway for projects | Persistent storage is tricky (need volumes or external DB) |
| Auto-deploy from Docker images | Shared filesystem (`~/.openclaw/`) doesn't exist in containers |

**Cost modeling:**

```
Per CEO pod (Railway):
  - Service: ~$5/mo base
  - Compute: ~$5-15/mo (varies with heartbeat frequency)
  - Volume: ~$1/mo (1 GB for workspace)
  = ~$11-21/mo per CEO pod

10 CEO pods  = $110-210/mo ($1,320-2,520/yr)
50 CEO pods  = $550-1,050/mo ($6,600-12,600/yr)
100 CEO pods = $1,100-2,100/mo ($13,200-25,200/yr)
```

**vs Hostinger:** At 10 pods, Railway costs 5-10x more than a VPS. At scale, the gap widens. Railway makes sense for **project hosting** (web apps that sleep), not for **always-on agent infrastructure**.

> [!WARNING]
> Heartbeat-driven agents don't sleep. They have cron jobs, scheduled tasks, and incoming message listeners. Railway's pay-per-use model penalizes always-on workloads.

---

### Option C: Hybrid (Recommended)

VPS fleet for agent infrastructure + Railway for product hosting.

```
┌──────────────────────────────────────────┐
│          Agent Infrastructure            │
│         (Hostinger VPS fleet)            │
│                                          │
│  VPS-1: Shared Services + 5 CEO pods    │
│  VPS-2: 10 CEO pods                      │
│  VPS-3: 10 CEO pods                      │
│  ...                                     │
└────────────────┬─────────────────────────┘
                 │ API calls
┌────────────────▼─────────────────────────┐
│          Product Hosting                  │
│         (Railway / Vercel)               │
│                                          │
│  chocks.ai (Railway)                     │
│  anti-cpq.com (Railway)                  │
│  shiplog.dev (Railway)                   │
│  glasswall.app (Railway)                 │
│  ...                                     │
└──────────────────────────────────────────┘
```

| Component | Where | Why |
|-----------|-------|-----|
| OpenClaw agent instances | Hostinger VPS | Always-on, cheap, persistent filesystem |
| Mission Control API + UI | Hostinger VPS-1 | Core orchestration, always-on |
| SaaS product web apps | Railway | Pay-per-use, auto-deploy, scales with customers |
| Databases | Railway / Supabase | Managed, backed up |
| DNS | Cloudflare | Already configured |

**Cost projection (hybrid):**

| Scale | VPS Cost/yr | Railway (products only) | Total |
|-------|-------------|------------------------|-------|
| 15 agents, 5 products | $80 | $25/mo | $380/yr |
| 30 agents, 10 products | $320 (2 VPS) | $50/mo | $920/yr |
| 100 agents, 30 products | $960 (4 VPS) | $150/mo | $2,760/yr |

Compare: $2,760/yr to run 100 autonomous agents producing 30 SaaS products. If even 10 hit $1k MRR, that's $120k ARR on $2.7k infra.

---

## Programmatic Scaling via Hostinger API

Hostinger provides a robust public API (`POST /api/vps/v1/virtual-machines`) and an official Terraform Provider (`hostinger_vps`). This allows 100% automated scaling.

### CEO Pod Provisioning (Docker + Terraform)

Running multiple CEOs natively on baremetal lacks hard isolation. One hallucinating agent could `rm -rf` another's workspace. 

**Best Practice:** Run each CEO Pod as a **Docker container**.
- **Isolation:** Filesystem, CPU/RAM limits, network namespaces.
- **Portability:** Can pack 5-10 containerized CEOs onto a single Hostinger VPS.

```hcl
# terraform example (conceptual)
resource "hostinger_vps" "pod_host" {
  count    = var.host_count
  plan     = "kvm2"
  hostname = "agent-host-${count.index}"
}

# Ansible or cloud-init then provisions Docker on the new VPS
# and spins up CEO containers:
#   docker run -d --name ceo_chocks -v /mnt/chocks-data:/home/node/.openclaw openclaw-base:latest
```

---

## Handling Shared Knowledge Across VPS Fleet

If you have 5 VPS servers hosting 50 CEOs in Docker containers, **do not try to use shared POSIX volumes (like NFS or SSHFS)** across the internet. It causes locking issues, latency, and single points of failure.

Instead, shift shared knowledge from "files on a disk" to "services over a network":

## 3. Shipping Updates to the Fleet (Custom Docker Builds)

If you don't control the base `openclaw` image, how do you distribute the `mission-control` skill to 500 CEOs?

You create a custom `Dockerfile` that builds on top of their official release. 

### The Fleet Image (`Dockerfile.fleet`)

```dockerfile
# Start from the official OpenClaw image
FROM ghcr.io/openclaw/openclaw:latest

# Copy your shared skills into the image
COPY ./shared-skills/ /home/node/.openclaw/skills/

# Install any host tools your agents rely on
RUN apt-get update && apt-get install -y jq curl postgresql-client

# (Optional) Set up the entrypoint to pull latest fleet configs
```

### Fleet Distribution Workflow

When you update the `mission-control` CLI skill:
1. You commit the change to your `mission-control` repo.
2. A GitHub Action builds `ghcr.io/negativezero/openclaw-fleet:latest`.
3. Mission Control triggers a rolling restart across your VPS servers:
   ```bash
   # MC ssh's into each VPS:
   docker pull ghcr.io/negativezero/openclaw-fleet:latest
   docker compose restart
   ```

Within 60 seconds, all 100+ CEOs wake up with the updated skill, with zero manual SSHing or fragile `scp` syncing.

| Factor | VPS Only | Railway Only | Hybrid |
|--------|----------|--------------|--------|
| Cost at 10 pods | ⭐⭐⭐ $80-240/yr | ⭐ $1,320-2,520/yr | ⭐⭐⭐ $380/yr |
| Cost at 100 pods | ⭐⭐ $960/yr | 💀 $13k+/yr | ⭐⭐⭐ $2,760/yr |
| Isolation | ⭐ (ports) | ⭐⭐⭐ (containers) | ⭐⭐ (VPS + containers) |
| Scaling effort | ⭐⭐ (manual SSH) | ⭐⭐⭐ (API-driven) | ⭐⭐ (scripted) |
| Persistent filesystem | ⭐⭐⭐ | ⭐ (volumes) | ⭐⭐⭐ |
| Always-on efficiency | ⭐⭐⭐ | ⭐ (pays for idle) | ⭐⭐⭐ |

> [!TIP]
> **Recommendation:** Hybrid. VPS for agents (cheap, always-on). Railway for products (pay-per-customer-traffic). This gives you $1M MRR economics — your infrastructure cost is a rounding error vs revenue.

---

*See also:*
- [fleet-architecture.md](file:///home/neg0/mission-control/docs/fleet-architecture.md) — CEO pod model
- [ai-drift-prevention.md](file:///home/neg0/mission-control/docs/ai-drift-prevention.md) — Keeping agents from wrecking infra
