# PRD: Mission Control CarPlay + Siri Cockpit (Internal)

**Owner:** Dustin
**Status:** Draft
**Last updated:** 2026-02-26
**Target:** Internal-only (single user)

---

## 1) Problem
Mission Control is valuable when you’re at a desk. The problem is **context loss + delayed response** when you’re away from keyboard.

We want a **car-safe, glanceable cockpit** that answers:
- What’s burning right now?
- Are we default-alive? (MRR trajectory)
- What should I approve / do next?
- Can I message Rocket hands-free and get a concise response?

---

## 2) Goals / Success Criteria

### Goals
- **Beautiful, functional, car-safe UI** for realtime status.
- **Two output formats** from Rocket:
  - CarPlay digest (short)
  - Full response (Discord/web)
- **Interrupt policy** that only interrupts for P0 issues.

### Success criteria (Phase 1)
- CarPlay shows:
  - Latest Rocket digest
  - Top 3 project cards (dynamic)
  - Fleet Health
  - Burning Tasks
  - PR/CI status
  - Log-scale MRR gauge
- Siri can:
  - “Tell Rocket …” (dictation)
  - “What’s burning?” (reads top alerts)
  - “Fleet status”
- Latency: home data loads < 2s (cached) and refreshes in background.

Non-goal: App Store approval.

---

## 3) User Stories

### US-1: Glanceable cockpit
> As Dustin, I want to see the most important fleet state in <10 seconds with minimal taps.

### US-2: Voice command → actionable digest
> As Dustin, I want to dictate a message to Rocket and receive a short digest for CarPlay plus a full response in Discord.

### US-3: Only interrupt when it matters
> As Dustin, I only want CarPlay interruptions for truly urgent issues.

---

## 4) Information Architecture (CarPlay UX)
CarPlay uses Apple templates (grid/list/info). We optimize for **clarity**, not complexity.

### Home screen tiles
1. **Rocket – Latest** (digest)
2. **Top Apps (3 dynamic cards)**
   - default pinned: CompIQ, SiteSwap, Mission Control
   - each card: status color, “next action”, blockers count
3. **Fleet Health**
4. **Burning Tasks**
5. **PR/CI status**
6. **MRR gauge (log scale)**

### Alerts screen
- List of alerts sorted by severity + age.
- Each alert has one car-safe action: Ack / Pause outreach / Open on phone.

### Project screen (tap from card)
- Today’s progress
- Top blockers
- Next 3 tasks

### Handoff
Every tile supports “Open on phone” deep link to full Mission Control.

---

## 5) Interrupt Policy (v1)

### P0 (driving interrupt)
- Prod down / core route failing
- CI blocking main for > 30 min
- Security/credential exposure
- Outreach deliverability emergency (bounces/complaints/suspension warning)
- Stripe payment/webhook failures

### P1 (quiet notify; escalates to P0 if persistent)
- Lighthouse gate regression
- Intermittent drip failures below threshold
- Gateway degraded but not down

### P2 (badge only)
- New PRs opened
- New non-blocking review comments

Escalation:
- Any P1 repeating >3 times or persisting >2h → P0.

---

## 6) Siri / CarPlay messaging contract (two-output)
Mission Control will label messages with `source=carplay` and request two outputs.

### Input metadata (to Rocket)
- `source=carplay`
- `reply_style=carplay_digest`
- `max_chars=480`
- `needs_two_outputs=true`

### Rocket output format

```text
[CARPLAY]
- Status: …
- Next: …
- Blockers: …
- Ask: …

[FULL]
<normal detailed response>
```

Mission Control routing:
- Show `[CARPLAY]` on CarPlay
- Send `[FULL]` to Discord + store in normal message timeline

---

## 7) API Contract (Mission Control)

### Read
- `GET /api/carplay/home`
  - returns tiles + digests (cached)
- `GET /api/carplay/alerts`
- `GET /api/carplay/project/:id`

### Write
- `POST /api/carplay/ack` (ack alert)
- `POST /api/carplay/action` (pause outreach, resume, kick rocket)
- `POST /api/carplay/message` (Siri dictation → Rocket)

### Auth
- Device-bound token (single-user), short-lived + refresh.
- Allowlist actions.
- Audit log every action.

---

## 8) Data Model (minimal additions)

### messages
- `id`
- `source` ("web" | "discord" | "carplay" | "siri")
- `carplay_digest` (text)
- `full_text` (text)
- `status`
- `created_at`

### alerts
- `id`
- `severity` (P0/P1/P2)
- `type` (ci/prod/outreach/security/stripe/fleet)
- `title`
- `detail`
- `dedupe_key`
- `triggered_at`
- `acknowledged_at`

---

## 9) Implementation Plan

### Phase 0 — Spec + endpoints (fast)
- Implement `/api/carplay/*` read endpoints (stubbed from existing status sources)
- Implement message contract + router to Rocket
- Implement interrupt evaluator (P0/P1/P2)

### Phase 1 — iOS CarPlay app (internal)
- CarPlay scene with grid/list templates
- Siri Shortcuts / App Intents
- Handoff deep links

### Phase 2 — Push notifications
- APNs for P0 + P1

---

## 10) Risks
- CarPlay template constraints (no fully custom UI)
- Interrupt fatigue if rules are too noisy
- Security: remote control surface must be locked down

---

## 11) Open Questions
- Do we want Rocket’s digest to include **one follow-up question** by default?
- Should the CarPlay app operate if Mission Control is offline (cached-only mode)?
