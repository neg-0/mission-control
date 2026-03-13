# E2E Testing Strategy — Mission Control v1.0

---

## Testing Layers

```
┌─────────────────────────────────────────────┐
│  Layer 3: E2E Tests (Playwright)            │  ← Browser-level, 3 critical paths
│  Validates: Full user workflows             │
├─────────────────────────────────────────────┤
│  Layer 2: API Integration Tests (Jest)      │  ← Route-level, > 90% coverage
│  Validates: Request → DB → Response         │
├─────────────────────────────────────────────┤
│  Layer 1: Unit Tests (Jest) ← EXISTS        │  ← Function-level, 15 suites
│  Validates: Business logic in isolation     │
└─────────────────────────────────────────────┘
```

---

## Stack

| Tool | Purpose | Why |
|------|---------|-----|
| **Jest + ts-jest** | Unit + API integration tests | Already configured, fast, good DX |
| **Playwright** | E2E browser tests | Best-in-class for Next.js, reliable, fast |
| **Prisma test utils** | Test database isolation | Clean state per test, no production data risk |

---

## Test Database Strategy

All tests run against a **separate test database**, never production.

```bash
# .env.test
DATABASE_URL="postgresql://localhost:5432/mission_control_test"
```

**Setup:**
1. `npx prisma migrate deploy` against test DB before test run
2. Each test suite resets relevant tables in `beforeEach`
3. Use Prisma's `$transaction` for test isolation where possible

**CI:**
```yaml
# GitHub Actions (or equivalent)
- name: Setup test DB
  run: |
    createdb mission_control_test
    npx prisma migrate deploy
- name: Run tests
  run: npm test
  env:
    DATABASE_URL: postgresql://localhost:5432/mission_control_test
```

---

## Layer 1: Unit Tests (Existing)

**Status:** 15 test suites, covering core business logic.

**Current coverage:**
- `orchestrator.test.ts` — Tick cycle logic
- `carplay-*.test.ts` — Mobile endpoints (4 suites)
- `idea-refinery.test.ts` — Validation pipeline
- `agent-loop.test.ts` — Runtime execution
- `goals.test.ts` — Strategic objectives
- `pipeline.test.ts` — SDLC gates
- `schemas.test.ts` — Validation
- `providers.test.ts` — LLM provider handling
- `token-utils.test.ts` — Railway token refresh
- `tools.test.ts` — Agent tooling
- `session-store.test.ts` — Session persistence
- `lifecycle-template.test.ts` — Checkpoint templates

**Action needed:** No changes. These are solid. Continue writing unit tests for new logic.

---

## Layer 2: API Integration Tests (New)

**Goal:** > 90% of the 62 API routes have at least one test.

### Priority Tiers

**Tier 1 — Must Test (breaks fleet if wrong):**
| Route | Test Cases |
|-------|-----------|
| `POST /api/orchestrator/tick` | Happy path (agents wake), no agents to wake, budget exceeded |
| `GET /api/orchestrator/config` | Returns singleton config |
| `POST /api/orchestrator/config` | Updates config, validates bounds |
| `GET /api/carplay/home` | Returns cached tiles, handles empty state |
| `POST /api/carplay/auth` | Valid device token, invalid token, expired token |
| `POST /api/carplay/message` | Message routed to Rocket, invalid payload |
| `POST /api/carplay/action` | Ack, pause, kick — each action type |
| `GET /api/carplay/alerts` | Returns sorted by severity, handles no alerts |
| `POST /api/escalations` | Create escalation, validate required fields |
| `PATCH /api/escalations/[id]` | Resolve, reject, invalid ID |
| `GET /api/dashboard` | Returns aggregated War Room data |
| `POST /api/manifest/validate` | Valid manifest, invalid manifest, missing fields |

**Tier 2 — Should Test (breaks features if wrong):**
| Route | Test Cases |
|-------|-----------|
| `GET /api/ideas` | List with filters, empty state |
| `POST /api/ideas` | Create idea, validate required fields |
| `PATCH /api/ideas/[id]` | Status transitions (draft → refining → validating) |
| `GET /api/projects` | List with relations |
| `POST /api/projects` | Create with Railway integration |
| `GET /api/goals` | List with progress calculation |
| `POST /api/tasks` | Create task, polymorphic assignee |
| `GET /api/costs` | List with date range filter |
| `POST /api/costs` | Create cost entry, validate amount |
| `GET /api/agents/runtime` | Agent runtime status |
| `POST /api/schedules` | Create schedule, validate cron expression |

**Tier 3 — Nice to Test (quality of life):**
- File browser routes (`/api/files/*`)
- Search (`/api/search`)
- GitHub PR fetching (`/api/github/prs`)
- Knowledge CRUD (`/api/knowledge/*`)
- Journal entries (`/api/journal`)
- Message bus (`/api/messages/*`)

### Test File Structure

```
src/lib/__tests__/
├── api/
│   ├── orchestrator.api.test.ts
│   ├── carplay.api.test.ts
│   ├── escalations.api.test.ts
│   ├── ideas.api.test.ts
│   ├── projects.api.test.ts
│   ├── goals.api.test.ts
│   ├── tasks.api.test.ts
│   ├── costs.api.test.ts
│   ├── dashboard.api.test.ts
│   ├── manifest.api.test.ts
│   └── schedules.api.test.ts
├── (existing unit tests...)
```

### API Test Pattern

```typescript
// Example: src/lib/__tests__/api/orchestrator.api.test.ts
import { createMocks } from 'node-mocks-http';
import { prisma } from '@/lib/prisma';

describe('POST /api/orchestrator/tick', () => {
  beforeEach(async () => {
    await prisma.agent.deleteMany();
    await prisma.schedule.deleteMany();
  });

  it('wakes agents with due schedules', async () => {
    // Seed: agent + schedule due now
    // Call: POST /api/orchestrator/tick
    // Assert: agent session created, journal entry logged
  });

  it('skips agents over budget', async () => {
    // Seed: agent with daily token usage > limit
    // Call: POST /api/orchestrator/tick
    // Assert: agent not woken, budget alert created
  });

  it('handles no agents gracefully', async () => {
    // No seed
    // Call: POST /api/orchestrator/tick
    // Assert: 200 OK, empty result
  });
});
```

---

## Layer 3: E2E Tests (New — Playwright)

### Setup

```bash
npm install -D @playwright/test
npx playwright install chromium
```

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:3000',
  },
});
```

### E2E Test 1: Orchestrator Tick Cycle

**File:** `e2e/orchestrator-tick.spec.ts`

**Flow:**
1. Seed test DB with an agent + schedule due now
2. Trigger `POST /api/orchestrator/tick`
3. Verify agent session was created
4. Verify journal entry was logged
5. Navigate to War Room, verify agent card shows "Active" status
6. Verify the tick is reflected in orchestrator logs

**Assertions:**
- Agent status transitions: idle → active → idle
- Journal entry contains: `did`, `next`, `blockers`
- War Room reflects the updated state

### E2E Test 2: Idea Pipeline

**File:** `e2e/idea-pipeline.spec.ts`

**Flow:**
1. Navigate to `/factory`
2. Create a new idea (title, description)
3. Verify it appears in the "Draft" column
4. Move to "Refining" (via API or drag-drop)
5. Start a validation sprint (via API — set deadline to 1 minute from now for test speed)
6. Simulate signups via webhook (`POST /api/webhooks/refinery/[ideaId]`)
7. Trigger verdict cron (`POST /api/cron-jobs` with refinery verdict)
8. Verify idea moved to "Graduated" or "Graveyard" based on signup count

**Assertions:**
- Idea transitions through all Kanban columns
- Validation metrics are updated
- Verdict is logged
- Post-mortem generated for killed ideas

### E2E Test 3: Alert Escalation

**File:** `e2e/alert-escalation.spec.ts`

**Flow:**
1. Create a P2 alert via API
2. Verify it appears in the War Room alerts panel
3. Simulate time passing (update `triggered_at` to > 2h ago)
4. Trigger escalation cron (`POST /api/cron/alert-rules`)
5. Verify alert is now P1
6. Simulate the condition clearing (e.g., mark CI as passing)
7. Trigger auto-resolution check
8. Verify alert is marked as resolved

**Assertions:**
- Alert appears at correct severity
- Escalation changes the severity level
- Auto-resolution clears the alert
- Escalation history is recorded

### E2E Test 4: War Room Smoke Test

**File:** `e2e/war-room-smoke.spec.ts`

**Flow:**
1. Seed test DB with representative data (3 agents, 2 ideas, 1 alert, cost entries)
2. Navigate to `/`
3. Verify all three panels render
4. Verify agent cards show status indicators
5. Verify MRR meter shows a numeric value
6. Verify alert banner shows highest severity
7. Check for zero console errors

**Assertions:**
- Page loads in < 2 seconds
- No JavaScript errors in console
- All panels have content (not empty/loading state)

---

## CI Integration

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  unit-and-api:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: mission_control_test
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/mission_control_test
      - run: npm test
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/mission_control_test

  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: mission_control_test
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/mission_control_test
      - run: npx playwright test
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/mission_control_test
```

---

## Test Coverage Targets

| Layer | Current | v1.0 Target |
|-------|---------|-------------|
| Unit tests | 15 suites | 15+ (maintain) |
| API integration tests | 0 | 30+ routes covered (> 90%) |
| E2E tests | 0 | 4 tests (3 critical paths + smoke) |
| Total test runtime | ~15s | < 3 minutes |

---

## Conventions

- **File naming:** `*.test.ts` for unit/API, `*.spec.ts` for E2E
- **Test DB:** Always use `mission_control_test`, never production
- **Cleanup:** `beforeEach` resets relevant tables; no test depends on another test's state
- **No mocking the DB:** API integration tests hit a real (test) database
- **Mock external services:** Gateway WebSocket, GitHub API, Railway API are mocked
- **Deterministic data:** No `Date.now()` in assertions; use fixed timestamps
