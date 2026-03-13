# PRD: Mission Control v1.0 — The Autonomous War Room

**Owner:** Dustin Stringer
**Status:** Draft
**Last updated:** 2026-03-12
**Target:** v1.0 (48h autonomous operations)

---

## 1. Vision

Mission Control is the **single control surface** for Negative Zero's autonomous AI agent fleet. It replaces SSH, terminal access, and manual intervention with a War Room that gives simultaneous visibility into fleet health, revenue trajectory, and pending decisions.

**v1.0 Success Criterion:** The fleet operates autonomously for 48 continuous hours with Mission Control as the only interface Dustin needs.

### Core Principles

1. **War Room, not Dashboard** — Equal weight on three concerns: Is anything broken? Are we making money? What should I decide? Every screen answers at least one.
2. **Solo Operator** — One user, zero onboarding. Optimize for information density and keyboard shortcuts, not multi-tenancy.
3. **Anti-Drift First** — The #1 blocker to autonomy is agents getting stuck or drifting. Every feature either prevents drift, detects drift, or recovers from drift.
4. **No SSH Required** — If Dustin has to open a terminal to fix something, that's a bug in Mission Control.

---

## 2. Problem Statement

The fleet has 13+ agents across multiple products. Current pain:

| Pain | Frequency | Impact |
|------|-----------|--------|
| Agent drifts off-target (wrong deploy, bad assumption) | Weekly | Hours of manual recovery |
| Silent infrastructure failures (tokens expire, deploys fail) | Weekly | Revenue/uptime loss until discovered |
| No single view of revenue vs burn | Daily check | Context switching between Railway, Stripe, spreadsheets |
| Idea pipeline stalls without manual nudging | Ongoing | Missed opportunities, wasted research |
| Can't leave the desk for 48h without checking in | Always | Founder bottleneck |

### Root Cause

Agents lack **guardrails with teeth** (drift prevention is documented but not enforced), **self-healing capabilities** (MC detects problems but can't fix them), and **proactive escalation** (alerts exist but don't auto-escalate or auto-recover).

---

## 3. User Profile

**Dustin Stringer** — Solo founder/operator of Negative Zero Inc. Technical (full-stack engineer), manages the fleet from a laptop and (via CarPlay) from a car. Needs to context-switch between strategic decisions and tactical interventions in seconds.

- **Operates from:** Laptop (primary), CarPlay/Siri (mobile)
- **Decision cadence:** Morning triage, ad-hoc interventions, evening review
- **Risk tolerance:** High for experimentation, low for silent failures

---

## 4. Scope — What's In v1.0

### 4.1 War Room Dashboard (Existing — Refine)

The primary view. Three-panel layout answering the core questions simultaneously:

- **Health Panel:** Fleet status, blocked agents, failing CI, expiring tokens
- **Revenue Panel:** MRR meter (log scale), burn rate, default-alive indicator
- **Decision Panel:** Ideas awaiting approval, escalations pending, stalled goals

**Key refinement:** Surface the single most important action as a prominent CTA. "What should I do right now?"

### 4.2 Drift Detection & Auto-Recovery (New — Critical Path)

The biggest gap. Agents drift because:
1. They lose context between sessions
2. They make "reasonable" but wrong assumptions
3. Nothing validates their actions against the project manifest

**v1.0 scope:**
- **Heartbeat context injection** — Before every agent wake, MC injects current sprint, known gotchas, and project.lock.json into the agent's context
- **Pre-action validation** — MC validates deploy commands, DB operations, and file modifications against project.lock.json before execution
- **Drift score** — Each agent gets a drift score based on: time since last journal, deviation from assigned goals, failed validations. Score > threshold triggers auto-pause + escalation
- **Auto-recovery playbooks** — For common failures (expired token, failed deploy, stalled CI), MC executes a predefined recovery sequence before escalating to human

### 4.3 Orchestrator Hardening (Existing — Harden)

The tick cycle is built but needs reliability guarantees:
- **Missed tick detection** — If a tick doesn't fire, the next tick catches up and alerts
- **Agent health checks** — Verify agent is responsive, not just "last heartbeat was recent"
- **Budget circuit breaker** — Auto-pause agents exceeding token/cost thresholds
- **Graceful degradation** — If the gateway is down, MC queues actions and replays when it reconnects

### 4.4 Idea Pipeline Automation (Existing — Complete)

The refinery is built but the 48h sprint verdict needs real metrics:
- **Waitlist integration** — Wire up actual signup tracking (webhook receiver exists, needs provider)
- **Auto-verdict with override** — Refiner runs verdict logic; Dustin gets a notification with "Agree / Override" before graduation or kill
- **Post-mortem on killed ideas** — Auto-generate a brief "why this failed" entry for knowledge base

### 4.5 Alert Escalation & Resolution (Existing — Complete)

Alerts exist but don't auto-escalate or resolve:
- **Escalation ladder:** P2 → P1 (if persists 2h or repeats 3x) → P0 (driving interrupt via CarPlay push)
- **Auto-resolution:** If the condition clears (CI passes, deploy succeeds), auto-resolve and log
- **Snooze / Acknowledge** — One-click from War Room or CarPlay
- **Escalation history** — Track mean-time-to-acknowledge and mean-time-to-resolve

### 4.6 Full API Test Coverage (New)

Every route tested. See [E2E-TESTING-STRATEGY.md](E2E-TESTING-STRATEGY.md).

### 4.7 CarPlay Reliability (Existing — Harden)

API is built. Needs:
- **Cached fallback** — If MC is unreachable, show last-known state with staleness indicator
- **Push notifications** — APNs for P0 alerts (Phase 2 of CarPlay PRD)
- **Action confirmation** — "Are you sure?" for destructive CarPlay actions (pause outreach, kick agent)

---

## 5. What's Out of v1.0

| Feature | Why Deferred |
|---------|-------------|
| Multi-machine fleet (Phase 4) | Current VPS handles 13 agents fine |
| Docker container isolation | Blocked on multi-machine; single VPS doesn't need it |
| Vector knowledge search | KnowledgeEntry schema exists; wiring to pgvector is a v1.5 enhancement |
| Native iOS CarPlay app | API-first; native app is a separate workstream |
| Multi-user / auth | Solo operator — unnecessary complexity |
| AI drift prevention Layer 3 (Docker read-only mounts) | Requires containerization (deferred) |

---

## 6. Success Metrics

### Primary: 48h Autonomous Operations

Run the fleet for 48 continuous hours. Success = Dustin does not need to:
- SSH into any machine
- Manually restart any agent
- Manually fix any infrastructure issue
- Open any tool other than Mission Control (web or CarPlay)

### Secondary Metrics

| Metric | Target |
|--------|--------|
| Agent drift incidents per week | < 2 (down from ~5) |
| Mean time to detect failure | < 5 minutes |
| Mean time to auto-recover | < 15 minutes (for known failure types) |
| War Room page load | < 2 seconds |
| Alert false positive rate | < 10% |
| API test coverage | > 90% of routes |
| E2E test coverage | 3 critical paths fully covered |

---

## 7. Addendums

- [CarPlay + Siri Cockpit PRD](carplay-prd.md)
- [User Stories](USER-STORIES.md)
- [Definition of Done](DEFINITION-OF-DONE.md)
- [Roadmap](ROADMAP.md)
- [E2E Testing Strategy](E2E-TESTING-STRATEGY.md)
- [Fleet Architecture](fleet-architecture.md)
- [AI Drift Prevention](ai-drift-prevention.md)
- [Infrastructure Scaling](infrastructure-scaling.md)
