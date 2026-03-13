# Roadmap — Mission Control v1.0

**Target:** 48h autonomous fleet operations
**Timeline:** 4 weeks (2026-03-12 → 2026-04-09)
**Approach:** Ship the critical path first. Testing in parallel. Cut scope ruthlessly.

---

## Phase Overview

```
Week 1 ──── Week 2 ──── Week 3 ──── Week 4
  │            │            │            │
  ▼            ▼            ▼            ▼
Drift        Alert        Test        48h
Prevention   Pipeline     Coverage    Trial
+ Recovery   + Orchestr.  + E2E      + Polish
```

---

## Week 1: Drift Prevention & Auto-Recovery (Mar 12-18)

**Theme:** Stop agents from going off the rails.

| # | Task | Stories | Priority | Effort |
|---|------|---------|----------|--------|
| 1.1 | Implement drift score calculation | US-201 | P0 | 4h |
| 1.2 | Add drift score to agent cards in War Room | US-201 | P0 | 2h |
| 1.3 | Auto-pause on drift score > 80 | US-202 | P0 | 3h |
| 1.4 | Pre-action validation against project.lock.json | US-203 | P0 | 4h |
| 1.5 | Auto-recovery: token refresh | US-204 | P0 | 2h |
| 1.6 | Auto-recovery: failed deploy retry | US-204 | P1 | 3h |
| 1.7 | Auto-recovery: stalled CI cancel + retry | US-204 | P1 | 3h |
| 1.8 | Auto-recovery: agent restart on missed heartbeats | US-204 | P1 | 2h |
| 1.9 | Recovery logging (trigger, action, outcome) | US-204 | P0 | 2h |

**Week 1 Exit Criteria:**
- [ ] Drift score visible on every agent card
- [ ] Auto-pause triggers on high drift (tested manually)
- [ ] At least 2 auto-recovery playbooks work end-to-end
- [ ] All recovery actions logged

---

## Week 2: Alert Pipeline & Orchestrator Hardening (Mar 19-25)

**Theme:** Alerts that escalate, resolve, and don't cry wolf.

| # | Task | Stories | Priority | Effort |
|---|------|---------|----------|--------|
| 2.1 | P2 → P1 auto-escalation (2h persistence) | US-401 | P0 | 3h |
| 2.2 | P1 → P0 auto-escalation (2h or 3x repeat) | US-401 | P0 | 3h |
| 2.3 | Auto-resolution for CI, deploy, token alerts | US-402 | P0 | 4h |
| 2.4 | Acknowledge + Snooze UI in War Room | US-403 | P0 | 3h |
| 2.5 | Escalation metrics (MTTA, MTTR) | US-404 | P2 | 3h |
| 2.6 | Missed tick detection + catch-up | US-501 | P1 | 3h |
| 2.7 | Budget circuit breaker | US-502 | P1 | 3h |
| 2.8 | Gateway reconnection + action queue replay | US-503 | P1 | 4h |
| 2.9 | War Room "Top Priority" CTA | US-101 | P1 | 2h |

**Week 2 Exit Criteria:**
- [ ] Alert escalation ladder works end-to-end (P2 → P1 → P0)
- [ ] Auto-resolution works for at least 2 condition types
- [ ] Acknowledge and snooze work from UI
- [ ] Orchestrator handles missed ticks and gateway disconnects gracefully

---

## Week 3: Test Coverage & E2E (Mar 26 - Apr 1)

**Theme:** Trust the system. Prove it works.

| # | Task | Stories | Priority | Effort |
|---|------|---------|----------|--------|
| 3.1 | Set up Playwright for E2E tests | US-602, US-603 | P0 | 3h |
| 3.2 | E2E: Orchestrator tick cycle | US-602 | P0 | 4h |
| 3.3 | E2E: Idea pipeline (create → verdict) | US-602 | P0 | 4h |
| 3.4 | E2E: Alert escalation (detect → escalate → resolve) | US-602 | P0 | 4h |
| 3.5 | War Room smoke test (Playwright) | US-603 | P0 | 2h |
| 3.6 | API route test backfill (target > 90%) | US-601 | P1 | 8h |
| 3.7 | CI pipeline: tests block merge on failure | US-601 | P1 | 2h |
| 3.8 | Idea auto-verdict with override window | US-302 | P1 | 3h |
| 3.9 | Killed idea post-mortem generation | US-302 | P2 | 2h |

**Week 3 Exit Criteria:**
- [ ] 3 E2E critical path tests passing
- [ ] War Room smoke test passing
- [ ] > 90% API route coverage
- [ ] CI blocks merge on test failure

---

## Week 4: 48h Trial & Polish (Apr 2-9)

**Theme:** Run it for real. Fix what breaks.

| # | Task | Stories | Priority | Effort |
|---|------|---------|----------|--------|
| 4.1 | Start 48h autonomous trial (Mon morning) | DoD | P0 | — |
| 4.2 | Monitor and document any manual interventions | DoD | P0 | — |
| 4.3 | Fix blockers discovered during trial | DoD | P0 | Variable |
| 4.4 | Second 48h trial if first one fails | DoD | P0 | — |
| 4.5 | War Room UX polish (based on trial learnings) | US-101 | P2 | 4h |
| 4.6 | Update docs (API.md, .env.example) | DoD | P1 | 2h |
| 4.7 | Tag v1.0.0 release | DoD | P0 | 30m |

**Week 4 Exit Criteria:**
- [ ] 48h trial completed successfully
- [ ] Zero SSH interventions during trial
- [ ] All tests green
- [ ] v1.0.0 tagged

---

## Milestone Summary

| Milestone | Date | Key Deliverable |
|-----------|------|-----------------|
| M1: Drift Prevention | Mar 18 | Drift scores, auto-pause, auto-recovery |
| M2: Alert Pipeline | Mar 25 | Escalation ladder, auto-resolution, orchestrator hardening |
| M3: Test Coverage | Apr 1 | E2E tests, API coverage, CI enforcement |
| M4: v1.0 Ship | Apr 9 | 48h trial passed, release tagged |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Auto-recovery playbooks have edge cases not covered | High | Medium | Log everything; iterate during Week 4 trial |
| Drift score formula needs tuning | Medium | Low | Start simple (4 factors), tune based on false positives |
| E2E tests are flaky | Medium | Medium | Use test database, deterministic data, no timing dependencies |
| 48h trial reveals unknown failure modes | High | High | Budget Week 4 for fixes; accept a second trial if needed |
| Gateway instability during trial | Low | High | Gateway reconnection (Week 2) + cached fallback |

---

## Post-v1.0 (Backlog)

These are explicitly **not** in the 4-week window:

- Vector knowledge search (pgvector integration)
- CarPlay native iOS app
- Multi-machine fleet (Phase 4 of fleet-architecture.md)
- Docker container isolation for CEO pods
- Waitlist provider integration (Tally/Carrd/custom)
- Marketing Engine panel in War Room
- Idea → CEO spawn automation (currently manual after approval)
