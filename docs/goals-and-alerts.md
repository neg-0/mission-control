# Goals & Alerts — Data Flow Reference

## Goals

### Source

`GOALS.md` in each workspace root (e.g. `$OPENCLAW_HOME/workspace-rocket/GOALS.md`)

### Expected Format

```markdown
## 🟡 G-001: Build the MVP
**Owner:** Rocket
**Created:** 2026-02-01

- [x] Set up database schema
- [x] Create API endpoints
- [ ] Build frontend
- [ ] Deploy to staging

### Blockers
- Need DNS configured for staging domain
```

### Status Emojis

| Emoji | Meaning |
|-------|---------|
| 🟢 | Done |
| 🟡 | Active / In Progress |
| 🔴 | Blocked |
| ⚪ | Backlog |

### Parsing Logic (`src/lib/goals.ts`)

1. **Header regex**: `/## (🟢|🟡|🔴|⚪) (G-\d+): (.+)/g`
2. **Progress %**: `count of [x]` / `total of [x] or [ ]` × 100
   - No checklist + 🟢 status → 100%
   - No checklist + any other status → 0%
3. **Owner**: extracted from `**Owner:** XYZ`
4. **Blockers**: parsed from `### Blockers` subsection — each `- item` line

### Data Flow

```
GOALS.md (on disk)
  → /api/files/read?path=GOALS.md&workspace=...
  → parseGoals(content) → Goal[]
  → GoalsTracker component
  → extractBlockingItems(goals) → BlockingItem[]
```

### Blocking Items

`extractBlockingItems()` scans non-green goals for blockers and categorizes them:

| Pattern in blocker text | Action assigned |
|------------------------|-----------------|
| `PR #123` | "Review PR" or "Merge PR" |
| `DNS` / `domain` | "Configure DNS" |
| `API` / `key` / `credential` | "Get Credentials" |
| Everything else | "Review" |

---

## Alerts

### Source

Computed dynamically from PRs + Goals + Agents in `src/lib/alerts.ts`.

### Alert Rules

| Condition | Level | Message |
|-----------|-------|---------|
| PR CI failing > 24h | 🔴 Red | "PR #42 has failing CI for >24h" |
| PR needs review > 48h | 🟡 Yellow | "PR #42 needs review for >48h" |
| Goal 🔴 blocked > 3 days | 🔴 Red | "G-003 blocked for >3 days" |
| Goal 🟡 active, no progress > 2 days | 🟡 Yellow | "G-005 has no progress for >2 days" |
| Agent failed | 🔴 Red | "Agent Captain failed" |
| Nothing wrong | 🟢 Green | "All clear" |

### Known Limitation

The "no progress" alert uses the goal's `created` date, not a "last updated" date. It flags goals created > 2 days ago that still have incomplete tasks — not goals where progress actually stalled.

### Where Alerts Appear

- **Alert banner** — top of the main content area (highest severity shown)
- **Alerts card** — right column, lists all individual alerts with LED indicators
