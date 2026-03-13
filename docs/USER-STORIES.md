# User Stories — Mission Control v1.0

**Persona:** Dustin (solo operator, founder of Negative Zero Inc.)

All stories target the v1.0 goal: **48h autonomous fleet operations with MC as the only control surface.**

---

## Epic 1: War Room (Morning Triage)

### US-101: Morning Coffee Status
> As Dustin, I want to open one URL and immediately see (a) if anything is broken, (b) how much money we made, and (c) what decisions are waiting for me — so I can triage in under 60 seconds.

**Acceptance Criteria:**
- [ ] War Room loads in < 2 seconds
- [ ] Health panel shows: blocked agents (red), stale agents (yellow), healthy agents (green)
- [ ] Revenue panel shows: current MRR (log-scale meter), burn rate, default-alive/dead indicator, delta since yesterday
- [ ] Decision panel shows: ideas awaiting approval, escalations pending resolution, goals with no progress > 2 days
- [ ] A single "Top Priority" CTA is prominently displayed — the highest-leverage action right now

### US-102: One-Click Agent Intervention
> As Dustin, I want to wake, pause, or restart any agent from the War Room — so I never need to SSH in.

**Acceptance Criteria:**
- [ ] Each agent card has Wake / Pause / Restart actions
- [ ] Actions execute within 5 seconds and show confirmation
- [ ] Failed actions show the error and suggest a recovery step
- [ ] Action history is logged in the audit trail (MessageLog)

### US-103: Fleet-Wide Search
> As Dustin, I want to search across all agent workspaces from one search bar — so I can find any file, goal, or blocker without knowing which agent owns it.

**Acceptance Criteria:**
- [ ] Search bar in the War Room header
- [ ] Results include: files, goals, journal entries, escalations
- [ ] Results link directly to the relevant detail view
- [ ] Search completes in < 1 second (Fuse.js or equivalent)

---

## Epic 2: Drift Detection & Recovery

### US-201: Drift Score Visibility
> As Dustin, I want to see a drift score for each agent — so I know which ones are operating normally and which are veering off-target.

**Acceptance Criteria:**
- [ ] Each agent card shows a drift score (0-100, where 0 = on-track, 100 = fully drifted)
- [ ] Score factors: time since last journal entry, goal alignment (tasks match assigned goals), validation failures, heartbeat staleness
- [ ] Agents with score > 60 are auto-highlighted in the War Room
- [ ] Clicking the score shows the breakdown (which factors are contributing)

### US-202: Auto-Pause on High Drift
> As Dustin, I want agents with dangerously high drift scores to auto-pause — so they stop causing damage before I intervene.

**Acceptance Criteria:**
- [ ] Drift score > 80 triggers auto-pause
- [ ] Auto-pause sends a P1 alert with the drift breakdown
- [ ] Auto-paused agents show a "Drifted — Review Required" badge
- [ ] Dustin can resume with one click after reviewing the situation

### US-203: Pre-Action Validation
> As Dustin, I want MC to validate agent actions against project.lock.json before execution — so agents can't deploy to the wrong platform or run forbidden commands.

**Acceptance Criteria:**
- [ ] Deploy commands are checked against `allowed_deploy_commands` in the manifest
- [ ] Forbidden operations (DROP TABLE, rm -rf, etc.) are blocked and logged
- [ ] Blocked actions generate a P1 alert with the attempted command
- [ ] Validation runs in < 100ms (no perceptible delay to agents)

### US-204: Auto-Recovery Playbooks
> As Dustin, I want MC to automatically recover from common failures — so the fleet keeps running without waking me up.

**Acceptance Criteria:**
- [ ] Expired Railway token → auto-refresh via `/cron/refresh-tokens`
- [ ] Failed deploy → retry once, then escalate if still failing
- [ ] Stalled CI (> 30 min) → cancel and re-trigger, then escalate
- [ ] Agent unresponsive (missed 3 heartbeats) → restart agent, then escalate if still unresponsive
- [ ] Each auto-recovery is logged with: trigger, action taken, outcome
- [ ] If auto-recovery fails, escalate to P0

---

## Epic 3: Idea Pipeline (The Refinery)

### US-301: Idea Kanban with Live Metrics
> As Dustin, I want to see all ideas in a Kanban board with live validation metrics — so I can track which ideas are winning and which are dying.

**Acceptance Criteria:**
- [ ] Kanban columns: Draft, Refining, Validating (The Arena), Graduated, Graveyard
- [ ] Validating cards show: countdown timer, signup count vs target, conversion rate
- [ ] Cards are color-coded by score (green > 70, yellow 40-70, red < 40)
- [ ] Drag-and-drop to manually move ideas between columns

### US-302: 48h Sprint with Auto-Verdict
> As Dustin, I want the Refiner to automatically evaluate ideas after the 48h validation window — so ideas don't stall waiting for my manual review.

**Acceptance Criteria:**
- [ ] When validation deadline expires, Refiner checks signup count vs target
- [ ] If target met: idea moves to Graduated, Dustin gets a notification to confirm or override
- [ ] If target missed: idea moves to Graveyard with auto-generated post-mortem
- [ ] Override window: 24 hours. After 24h with no override, verdict is final
- [ ] Post-mortem includes: original hypothesis, actual metrics, suggested learnings

### US-303: One-Click Idea Approval
> As Dustin, I want to approve a validated idea and have MC spawn a CEO agent — without typing CLI commands.

**Acceptance Criteria:**
- [ ] Graduated ideas show an "Approve & Spawn CEO" button
- [ ] Clicking it creates a Project, assigns a CEO agent, and sets up the workspace
- [ ] The new project appears in the Fleet view within 30 seconds
- [ ] If spawning fails, show the error and allow retry

---

## Epic 4: Alert Escalation & Resolution

### US-401: Automatic Alert Escalation
> As Dustin, I want alerts to automatically escalate if they persist or repeat — so I only get interrupted for things that truly need my attention.

**Acceptance Criteria:**
- [ ] P2 alerts persisting > 2 hours auto-escalate to P1
- [ ] P1 alerts persisting > 2 hours or repeating > 3 times auto-escalate to P0
- [ ] P0 alerts trigger CarPlay push notification (when APNs is wired)
- [ ] Escalation history is tracked (when it escalated, from what level)

### US-402: Auto-Resolution
> As Dustin, I want alerts to auto-resolve when the underlying condition clears — so the War Room doesn't fill up with stale alerts.

**Acceptance Criteria:**
- [ ] CI failure alert auto-resolves when CI passes
- [ ] Deploy failure alert auto-resolves when deploy succeeds
- [ ] Token expiry alert auto-resolves when token is refreshed
- [ ] Auto-resolved alerts are logged with resolution time
- [ ] Auto-resolved alerts show as "Resolved" (not deleted) for audit trail

### US-403: Alert Acknowledge & Snooze
> As Dustin, I want to acknowledge or snooze alerts from the War Room or CarPlay — so I can manage noise without losing track.

**Acceptance Criteria:**
- [ ] One-click "Acknowledge" marks the alert as seen (stops escalation timer)
- [ ] "Snooze 1h / 4h / 24h" pauses the alert temporarily
- [ ] Snoozed alerts return at the snoozed severity (don't re-escalate from P2)
- [ ] Acknowledged/snoozed state syncs between web and CarPlay

### US-404: Escalation Metrics
> As Dustin, I want to see mean-time-to-acknowledge and mean-time-to-resolve — so I can tune alert rules over time.

**Acceptance Criteria:**
- [ ] Settings page shows: MTTA, MTTR, alert volume by severity, false positive rate
- [ ] Metrics cover the last 7 and 30 days
- [ ] Alerts with MTTR > 24h are flagged for rule review

---

## Epic 5: Orchestrator Reliability

### US-501: Missed Tick Detection
> As Dustin, I want MC to detect when a tick doesn't fire and catch up — so agent schedules don't silently break.

**Acceptance Criteria:**
- [ ] If a tick is > 2x overdue, the next tick catches up and logs a warning
- [ ] Missed ticks generate a P1 alert if > 3 consecutive misses
- [ ] Orchestrator status shows: last tick time, next scheduled tick, tick health

### US-502: Budget Circuit Breaker
> As Dustin, I want MC to auto-pause agents that exceed their token/cost budget — so a runaway agent doesn't burn through API credits.

**Acceptance Criteria:**
- [ ] Each agent has a configurable daily token limit
- [ ] When an agent exceeds 80% of its limit, MC logs a warning
- [ ] When an agent exceeds 100%, MC auto-pauses and sends a P1 alert
- [ ] Dustin can override (increase limit or resume) from the War Room

### US-503: Gateway Reconnection
> As Dustin, I want MC to gracefully handle gateway disconnects — so a network blip doesn't cascade into fleet-wide failures.

**Acceptance Criteria:**
- [ ] When the gateway disconnects, MC shows a banner with retry countdown
- [ ] MC queues pending actions during the disconnect
- [ ] When the gateway reconnects, MC replays queued actions in order
- [ ] If disconnected > 5 minutes, escalate to P0

---

## Epic 6: Testing & Reliability

### US-601: API Test Coverage
> As Dustin, I want every API route to have at least one test — so regressions are caught before deployment.

**Acceptance Criteria:**
- [ ] > 90% of API routes have at least one happy-path test
- [ ] Critical routes (orchestrator, carplay, escalations) have error-path tests
- [ ] Tests run in < 60 seconds total
- [ ] Tests are part of CI (fail the build on regression)

### US-602: E2E Critical Path Tests
> As Dustin, I want end-to-end tests for the three critical workflows — so I can trust that the system works as a whole.

**Acceptance Criteria:**
- [ ] E2E test: Orchestrator tick cycle (agent wakes → checks goals → journals → sleeps)
- [ ] E2E test: Idea pipeline (create → refine → validate → auto-verdict)
- [ ] E2E test: Alert escalation (condition detected → alert created → escalated → resolved)
- [ ] E2E tests run against a test database (not production)
- [ ] E2E tests are part of CI

### US-603: War Room Smoke Test
> As Dustin, I want a browser-level smoke test that verifies the War Room loads correctly — so I know the UI isn't broken.

**Acceptance Criteria:**
- [ ] Playwright test: navigate to `/`, verify all three panels render
- [ ] Verify agent cards appear with correct status indicators
- [ ] Verify MRR meter renders with a numeric value
- [ ] Verify no console errors on page load
- [ ] Test runs in < 30 seconds
