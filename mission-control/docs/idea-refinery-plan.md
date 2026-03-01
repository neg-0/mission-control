# 💡 Mission Control: The Idea Refinery

> **Objective:** Transform the "Idea" phase from a passive checklist into an active, agent-driven validation engine.
> **Goal:** Fail fast, validate cheap ($10 + 48h), and only build winners.

---

## 1. The Core Concept

Instead of ideas being "Task 1" of a Project, they live in a dedicated **Ideas Tab**. This is the "Pre-Seed" incubator.

**The Workflow:**
1.  **Draft:** Raw idea capture.
2.  **Refine:** Agents research pain, define avatar, and draft copy.
3.  **Validate (The Sprint):** A 48-hour "Go/No-Go" window.
    *   **Action:** Launch Waitlist.
    *   **Agent:** Pushes outreach (Reddit/Twitter/DM).
    *   **Metric:** Signups.
4.  **Verdict:**
    *   **GO:** Target reached (e.g., 10 signups) → Promoted to Project.
    *   **BUST:** Target missed → Archived. No code written.

---

## 2. The "Refiner" Agent 🤖

A specialized automation that runs every **30-60 minutes**.

**Role:** Growth Hacker / Product Validator.
**Authority:** Can kill ideas or promote them based on hard data.

### Routine (Every Tick)
1.  **Check Active Validations:** Find ideas in `validating` status.
2.  **Check Timer:** Is the 48h window open?
    *   **If Expired:** Run **Verdict Logic**.
3.  **Check Metrics:** Poll Waitlist provider (e.g., tally.so, carrd, custom).
    *   Update `Idea.validationMetrics`.
4.  **Execute Outreach (If Window Open):**
    *   *Scan:* Find 3 relevant Reddit threads posted in last 24h.
    *   *Action:* Draft/Post a helpful comment linking the problem to the waitlist.
    *   *Constraint:* 1 post per hour max (avoid spam).

---

## 3. Architecture Changes

### A. Database Schema (`schema.prisma`)

Update the `Idea` model to support the refinery process:

```prisma
model Idea {
  id          String   @id @default(uuid())
  title       String
  description String?
  score       Int      @default(0) // Initial confidence score
  
  // Refinery State
  status      String   @default("draft") // draft, refining, validating, graduated, killed
  stage       String   @default("pain_audit") // pain_audit, copy_draft, outreach
  
  // The Sprint
  validationStartedAt DateTime?
  validationDeadline  DateTime?
  
  // Data
  refineryData      Json?   // { painPoints: [], avatars: [], copyVariants: [] }
  validationMetrics Json?   // { signups: 12, traffic: 150, conversion: "8%" }
  
  // Relations
  project     Project?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### B. UI: The Ideas Tab

**1. The Kanban Board**
*   Columns: **New**, **Refining**, **Validating (The Arena)**, **Graduated**, **Graveyard**.
*   **The Arena Column:** Cards here display a **Countdown Timer** (47h 12m remaining) and a **Live Scoreboard** (3/10 Signups).

**2. Idea Detail View**
*   **Refinery Dashboard:**
    *   **Pain Points:** List of researched user complaints (citations to Reddit).
    *   **Avatar:** "Who are we selling to?"
    *   **Copy:** Generated H1/H2 variations.
*   **Validation Control:**
    *   "Start 48h Sprint" button.
    *   Live feed of "Refiner" agent actions ("Posted to r/SaaS", "Checked metrics").

---

## 4. Implementation Plan

### Phase 1: Data & UI Structure
1.  Update `schema.prisma` with new `Idea` fields.
2.  Create `GET /api/ideas` and `GET /api/ideas/[id]` (separate from Projects).
3.  Build **Ideas Tab** in Mission Control (Kanban layout).

### Phase 2: The Refinery Playbook (Skill)
Create `skills/idea-refinery` with tools:
*   `refinery_audit_pain(idea_id)`: Search Brave/Reddit for problem validation.
*   `refinery_draft_assets(idea_id)`: Generate landing page copy.
*   `refinery_start_sprint(idea_id)`: Set deadline + status = validating.

### Phase 3: The "Refiner" Automation
Create a scheduled agent task (`cron` or `orchestrator`):
*   **Schedule:** Every 30 mins.
*   **Logic:**
    *   Read `validating` ideas.
    *   Check metrics (mock for now, then integrate).
    *   If `now > deadline`:
        *   `signups >= 10` ? **Promote** : **Kill**.

---

## 5. Next Steps

1.  **Approve this Plan:** Shall we proceed with Phase 1 (Schema + UI)?
2.  **Define Waitlist Tech:** Do we use a simple Next.js template (deployed to Vercel per idea) or a 3rd party tool (Tally/Carrd)?
    *   *Recommendation:* **Simple Next.js Template**. We are Next.js experts. We can have a `waitlist-template` repo that the agent clones, configures (ENV vars), and deploys to Vercel in 1 click.
