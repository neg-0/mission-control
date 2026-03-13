# Definition of Done — Mission Control v1.0

---

## v1.0 Ship Criteria

Mission Control v1.0 is **done** when all of the following are true:

### 1. The 48-Hour Test

Run the fleet for 48 continuous hours. During this window, Dustin:

- [ ] Does **not** SSH into any machine
- [ ] Does **not** manually restart any agent
- [ ] Does **not** manually fix any infrastructure issue (token refresh, deploy retry, etc.)
- [ ] Does **not** open any tool other than Mission Control (web or CarPlay)
- [ ] Successfully triages the morning status in < 60 seconds
- [ ] Makes at least one decision (approve idea, acknowledge alert, etc.) from MC

**Failure criteria:** If Dustin has to leave MC to fix something, document what broke and why MC couldn't handle it. That becomes a blocker for v1.0.

### 2. Drift Prevention Works

- [ ] Pre-action validation catches at least one simulated bad deploy (test with a forbidden command)
- [ ] Drift score correctly identifies an agent that hasn't journaled in > 24h
- [ ] Auto-pause triggers on drift score > 80 (tested in staging)
- [ ] At least 2 auto-recovery playbooks work end-to-end (token refresh + failed deploy retry)

### 3. Alert Pipeline Works

- [ ] P2 → P1 escalation triggers after 2h persistence (tested)
- [ ] P1 → P0 escalation triggers after 2h persistence or 3x repeat (tested)
- [ ] Auto-resolution works for at least 2 condition types (CI pass, token refresh)
- [ ] Acknowledge and snooze work from the War Room UI

### 4. Test Coverage

- [ ] > 90% of API routes have at least one test
- [ ] 3 E2E critical path tests pass (orchestrator tick, idea pipeline, alert escalation)
- [ ] War Room smoke test passes (Playwright)
- [ ] All tests run in CI and block merge on failure
- [ ] Total test suite runs in < 3 minutes

### 5. War Room UX

- [ ] Page loads in < 2 seconds
- [ ] All three panels (health, revenue, decisions) render with live data
- [ ] Agent actions (wake/pause/restart) work from the UI
- [ ] No console errors on page load

---

## Per-Feature Definition of Done

Every feature (user story, bug fix, or enhancement) is **done** when:

### Code Quality
- [ ] Code is reviewed (self-review for solo; consider future PR reviews)
- [ ] No TypeScript errors (`npm run build` passes)
- [ ] No ESLint errors (`npm run lint` passes)
- [ ] No Prisma schema drift (`npx prisma generate` is clean)

### Testing
- [ ] Happy-path test exists for new API routes
- [ ] Error-path test exists for critical routes (orchestrator, carplay, escalations)
- [ ] Existing tests still pass (`npm test` green)
- [ ] If the feature touches a critical path, E2E test is updated

### Documentation
- [ ] API changes are reflected in `docs/API.md`
- [ ] Schema changes are reflected in Prisma schema comments
- [ ] User-facing behavior changes are reflected in the relevant user story (checkboxes updated)
- [ ] No new docs required for internal refactors

### Deployment
- [ ] Database migrations run cleanly (`npx prisma migrate deploy`)
- [ ] Feature works in production environment (Railway PostgreSQL, systemd service)
- [ ] No environment variable changes without updating `.env.example`

---

## Release Checklist (v1.0 Ship Day)

- [ ] All 48-hour test criteria met
- [ ] All E2E tests green in CI
- [ ] `npm run build` succeeds
- [ ] `npm run test` succeeds
- [ ] `npm run lint` succeeds
- [ ] Production database migrations applied
- [ ] `.env.example` is current
- [ ] PRD-V3.md status updated to "Shipped"
- [ ] ROADMAP.md milestones checked off
- [ ] Tag release: `git tag v1.0.0`
