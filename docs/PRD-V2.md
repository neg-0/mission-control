# PRD: Mission Control V2 (The War Room)

## 1. Vision & Strategy
**The "War Room"** is not just an observability tool—it is the **Command & Control** center for the AI Army.
It shifts the user's perspective from *Managing Agents* (DevOps) to *Managing a Portfolio* (Venture Capital).

**Core Philosophy:**
- **Business First, Code Second:** Metrics are $MRR, Users, and Pipeline velocity, not CPU usage or Git commits.
- **Logarithmic Scale:** The journey from $0 to $1M is non-linear. The dashboard must celebrate the small wins ($10, $100) just as loudly as the big ones.
- **Action-Oriented:** Every card must have a "Next Action" or a "Status" that prompts a decision.

---

## 2. Information Architecture (Data Flow)

### The Source of Truth Strategy
We avoid database complexity by using a **"File-Based Federation"** architecture. Each CEO agent owns their own `stats.json` and reports. Mission Control aggregates them.

| Data Layer | Source File | Responsible Agent | Update Frequency |
|------------|-------------|-------------------|------------------|
| **Fleet Status** | `AGENTS.md` | Rocket | On Spawn/Kill |
| **Business Metrics** | `workspace-*/stats.json` | CEO Agents (Captain, etc.) | Daily |
| **Idea Pipeline** | `projects/ideas/*.md` | Rocket / Research Agents | Ad-hoc |
| **Decisions/Blockers** | `projects/ai-army/reports/*.md` | CEO Agents | Daily Standup |
| **Global Progress** | `GOALS.md` | Rocket | Weekly |

### The Aggregator (The "Spy" Script)
A Python script (`ops/scripts/dashboard_aggregator.py`) runs on cron (every 10 min).
1.  Scans `AGENTS.md` to find active workspaces.
2.  Reads `stats.json` from each workspace.
3.  Parses `GOALS.md` for high-level progress.
4.  Parses `projects/ideas/` for pipeline status.
5.  Outputs a single `public/dashboard.json` for the Frontend to consume.

---

## 3. UI/UX Specification

### 3.1 The "Big Board" (Header)
**Visual:** Dark Mode. Cyberpunk/Terminal aesthetic but clean.
**Key Component:** The **$1M MRR Meter**.
- **Design:** A logarithmic progress bar (Log10 scale).
- **Markers:** $0, $10, $100, $1k, $10k, $100k, $1M.
- **Current Indicator:** Glowing needle showing total aggregated MRR.
- **Delta:** "+$50 this week" (Green text).

**Global Stats Ticker:**
`Agents: 7` | `Active Projects: 4` | `Total Users: 142` | `Burn Rate: $5/day`

### 3.2 The Factory (Idea Pipeline)
**Layout:** Horizontal Kanban (Scrollable).
**Columns:**
1.  **Inbox (Raw Ideas):** New entries in `projects/ideas/`.
2.  **Research (Agents Working):** Active Research Agents.
3.  **Validation (Go/No-Go):** Scored ideas waiting for approval.
4.  **Building (MVP):** Active CEO assigned.
5.  **Live (In Market):** Projects with live URLs.

**Card Component:**
- **Title:** "Idea-005: Anti-CPQ"
- **Score:** "79/100" (Color coded).
- **BLUF:** "Salesforce CPQ killer for SMB."
- **Status:** "Building"
- **Action Button:** "View Report" (Opens MD file).

### 3.3 The Fleet (Active Ventures)
**Layout:** Grid of "Command Cards" (One per CEO).

**Card Design:**
- **Header:** Agent Name + Emoji (e.g., 🚢 Captain).
- **Health Dot:** 🟢 (Check-in <24h) | 🔴 (Missing).
- **Business Stats:**
    - MRR: $0
    - Users: 12
    - Traffic: 50/day
- **Current Mission:** "Cold Emailing 5 CTOs" (Extracted from daily report).
- **Pre-Ship Checklist:** Mini progress bar (e.g., [||||||....] 60%).
- **Links:** [Repo] [App] [Logs].

### 3.4 The Marketing Engine (Growth)
**Layout:** Simple list or heatmap.
- **Channel Performance:**
    - "SEO (Mothership): 5 clicks"
    - "Cold Outbound: 50 sent, 2 replies"
    - "Twitter/X: 0 posts"
- **Experiments:** List of active growth hacks (e.g., "Waitlist Viral Loop").

---

## 4. User Stories

### US-1: "The Morning Coffee"
> As Dustin, I want to open one URL and see exactly how much money we made yesterday and if any agent is stuck, so I can intervene only where needed.
- **Acceptance:** Dashboard loads <1s. Red blockers are flashing/prominent.

### US-2: "The Decision"
> As Dustin, I want to see the "Validation" column of ideas, read the BLUF, and click "Approve" to spawn a CEO, without typing CLI commands.
- **Acceptance:** UI button triggers a `sessions_spawn` webhook (or flags file for Rocket to pick up).

### US-3: "The Reality Check"
> As Dustin, I want to see a brutally honest "Burn Rate" vs "MRR" comparison so I know if we are default-dead or default-alive.
- **Acceptance:** Burn rate calculated from API costs (estimated) vs Stripe MRR.

---

## 5. Implementation Roadmap

### Phase 1: The "Read-Only" Dashboard (MVP) - *Target: 48 Hours*
- [ ] **Standardize:** Enforce `stats.json` schema across all agents.
- [ ] **Aggregator:** Build `dashboard_aggregator.py`.
- [ ] **Frontend:** Deploy Next.js/Tailwind dashboard to `mission-control.negativezeroinc.com` (via Vercel).
- [ ] **Auth:** Basic BasicAuth or Token protection.

### Phase 2: The "Interactive" Dashboard (V1.5)
- [ ] **Controls:** Add "Wake Agent", "Pause Agent", "Spawn CEO" buttons (triggering Rocket webhooks).
- [ ] **Live Logs:** Stream `tail -f` of agent sessions via WebSocket.

### Phase 3: The "Brain" (V2)
- [ ] **Learning Loop:** Auto-summarize "Lessons Learned" from all agents into a "Wisdom" widget.
- [ ] **Market Pulse:** Integrate "Trend Watcher" agent data directly into the dashboard.

---

## 6. Technical Specs (Data Schemas)

### `stats.json` (Required in every workspace root)
```json
{
  "timestamp": "2026-02-11T05:00:00Z",
  "mrr": 0,
  "users_total": 15,
  "users_active": 2,
  "traffic_daily": 45,
  "checklist_completion": 0.8,
  "current_focus": "Fixing Stripe Webhook",
  "blocker": null
}
```

### `dashboard.json` (Generated Aggregation)
```json
{
  "updated_at": "...",
  "global": {
    "total_mrr": 105.00,
    "burn_rate_est": 5.00
  },
  "pipeline": [
    { "id": "IDEA-003", "name": "ChurnGuard", "stage": "Validation", "score": 69.5 }
  ],
  "fleet": [
    { "agent": "captain", "stats": { ... } }
  ]
}
```
