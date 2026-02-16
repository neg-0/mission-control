# Idea Refinery API Reference

**Base URL:** `http://localhost:3000/api`

> **Note:** All endpoints return JSON. Errors return status 4xx/5xx with `{ "error": "message" }`.

---

## 1. List Ideas

Fetch all ideas, optionally filtered by status. Used for the Kanban board.

```http
GET /ideas?status=validating
```

**Response:**
```json
[
  {
    "id": "IDEA-009",
    "title": "Relay",
    "status": "research",
    "stage": "pain_audit",
    "scorecards": [...],
    "project": null
  }
]
```

---

## 2. Create Idea

Draft a new idea to enter the funnel.

```http
POST /ideas
Content-Type: application/json

{
  "title": "New SaaS Idea",
  "description": "Solves problem X for Y",
  "source": "Reddit"
}
```

---

## 3. Get Idea Details

Fetch full details including refinery data and metrics.

```http
GET /ideas/:id
```

---

## 4. Start Validation Sprint (The Arena)

Kick off the 48-hour countdown. Sets status to `validating` and deadline to `now + 48h`.

```http
PATCH /ideas/:id
Content-Type: application/json

{
  "action": "start_sprint"
}
```

**Response:**
```json
{
  "id": "IDEA-009",
  "status": "validating",
  "validationDeadline": "2026-02-16T14:30:00Z",
  ...
}
```

---

## 5. Graduate to Project

Promote a validated idea to a Project. Creates the Project record and links it.

```http
PATCH /ideas/:id
Content-Type: application/json

{
  "action": "graduate"
}
```

**Response:**
```json
{
  "ideaId": "IDEA-009",
  "projectId": "IDEA-009"
}
```

---

## 6. Update Metrics/Refinery Data

Agents use this to log research or signup counts.

```http
PATCH /ideas/:id
Content-Type: application/json

{
  "validationMetrics": {
    "signups": 15,
    "traffic": 200
  },
  "refineryData": {
    "painPoints": ["Too expensive", "Slow support"]
  }
}
```

---

## 7. Delete Idea

Archive/Remove an idea.

```http
DELETE /ideas/:id
```
