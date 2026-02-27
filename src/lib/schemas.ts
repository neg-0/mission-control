/**
 * @module schemas
 * @description
 * Central Zod validation schemas for all Mission Control C2 API routes.
 *
 * These schemas define the **contract** between API callers (agents, skill scripts,
 * the MC frontend) and the backend. Each schema enforces:
 * - Required vs optional fields
 * - Type coercion and constraints (ranges, enums)
 * - Business rules (e.g. cronExpr XOR intervalMs)
 *
 * Usage in route handlers:
 * ```ts
 * import { CreateScheduleSchema } from '@/lib/schemas';
 *
 * export async function POST(request: NextRequest) {
 *   const result = CreateScheduleSchema.safeParse(await request.json());
 *   if (!result.success) {
 *     return NextResponse.json({ error: result.error.flatten() }, { status: 400 });
 *   }
 *   const body = result.data; // fully typed
 * }
 * ```
 */

import { z } from 'zod';

// =============================================================================
// SCHEDULES
// =============================================================================

/**
 * Schema for creating a new schedule.
 *
 * Business rule: exactly ONE of `cronExpr` or `intervalMs` must be provided.
 * - `cronExpr` — standard 5-field cron expression (min hour dom month dow)
 * - `intervalMs` — fixed interval in milliseconds
 *
 * @example
 * ```json
 * {
 *   "agentId": "rocket",
 *   "name": "Daily standup check",
 *   "cronExpr": "0 9 * * 1-5",
 *   "priority": 5
 * }
 * ```
 */
export const CreateScheduleSchema = z
  .object({
    /** Agent ID from the openclaw.json agent list (e.g. "rocket", "captain") */
    agentId: z.string().min(1, 'agentId is required'),
    /** Schedule type: "heartbeat" (MC-managed) or "cron" (OpenClaw-managed). Default: "cron" */
    type: z.enum(['heartbeat', 'cron']).default('cron'),
    /** Human-readable schedule name (shows in MC dashboard & message logs) */
    name: z.string().min(1, 'name is required'),
    /** Standard 5-field cron expression: `min hour dom month dow` */
    cronExpr: z.string().optional(),
    /** Fixed interval in milliseconds (minimum 10 seconds = 10000ms) */
    intervalMs: z.number().int().min(10000).optional(),
    /** Priority for the orchestrator tick (higher = processed first). Default: 0 */
    priority: z.number().int().min(0).max(100).default(0),
    /** Optional JSON payload sent to the agent on wake */
    payload: z.string().optional(),
    /** Delivery channel ("discord", "none", etc.). Default: "discord" */
    channel: z.string().default('discord'),
    /** Delivery target within channel (e.g. "user:339585248826228749") */
    deliverTo: z.string().nullable().optional(),
    /** Whether this schedule is active. Default: true */
    enabled: z.boolean().default(true),
  })
  .refine((data) => data.cronExpr || data.intervalMs, {
    message: 'Either cronExpr or intervalMs is required',
  })
  .refine((data) => !(data.cronExpr && data.intervalMs), {
    message: 'Specify cronExpr OR intervalMs, not both',
  });

/** Inferred TypeScript type from CreateScheduleSchema */
export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;

/**
 * Schema for updating an existing schedule.
 * All fields except `id` are optional — only provided fields are updated.
 */
export const UpdateScheduleSchema = z.object({
  /** The schedule's database UUID */
  id: z.string().uuid('id must be a valid UUID'),
  name: z.string().min(1).optional(),
  cronExpr: z.string().nullable().optional(),
  intervalMs: z.number().int().min(10000).nullable().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  payload: z.string().nullable().optional(),
  channel: z.string().optional(),
  deliverTo: z.string().nullable().optional(),
});

export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;

/**
 * Schema for deleting a schedule by ID.
 */
export const DeleteByIdSchema = z.object({
  /** The record's database UUID */
  id: z.string().uuid('id must be a valid UUID'),
});

export type DeleteByIdInput = z.infer<typeof DeleteByIdSchema>;

// =============================================================================
// ORCHESTRATOR CONFIG
// =============================================================================

/**
 * Schema for updating the orchestrator configuration singleton.
 *
 * The orchestrator controls how many agents can be woken per tick
 * and enforces rate limits to prevent API quota exhaustion.
 *
 * @example
 * ```json
 * { "maxWakesPerTick": 3, "minIntervalMs": 60000, "enabled": true }
 * ```
 */
export const UpdateOrchestratorConfigSchema = z
  .object({
    /** Max agents to wake per tick cycle (1–20). Default: 3 */
    maxWakesPerTick: z.number().int().min(1).max(20).optional(),
    /** Minimum ms between full tick cycles (≥10000). Default: 60000 */
    minIntervalMs: z.number().int().min(10000).optional(),
    /** Minimum ms gap between consecutive agent wakes within a tick (≥5000). Default: 30000 */
    staggerDelayMs: z.number().int().min(5000).optional(),
    /** How often the internal timer fires in ms (≥10000). Default: 60000 */
    tickIntervalMs: z.number().int().min(10000).optional(),
    /** Tokens-per-minute budget limit. null = unlimited */
    tpmLimit: z.number().int().nullable().optional(),
    /** Hours between quota resets (≥0.5). Default: 1 */
    quotaResetHours: z.number().min(0.5).optional(),
    /** How many recent journal entries to include in each heartbeat context (0–20). Default: 5 */
    journalEntries: z.number().int().min(0).max(20).optional(),
    /** Array of markdown file paths to inject into heartbeat context */
    mdInjections: z.array(z.string()).optional(),
    /** Enable/disable the orchestrator globally */
    enabled: z.boolean().optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'No valid fields to update' }
  );

export type UpdateOrchestratorConfigInput = z.infer<typeof UpdateOrchestratorConfigSchema>;

// =============================================================================
// ESCALATIONS
// =============================================================================

/** Valid severity levels for escalations */
export const ESCALATION_SEVERITIES = ['warning', 'critical', 'blocker'] as const;

/**
 * Schema for creating an escalation.
 *
 * Escalations are urgent alerts from agents to the human operator (Dustin).
 * They auto-generate a MessageLog entry on the "escalation" channel.
 *
 * @example
 * ```json
 * {
 *   "fromAgentId": "warden",
 *   "severity": "critical",
 *   "category": "security",
 *   "title": "SSL cert expires in 24h"
 * }
 * ```
 */
export const CreateEscalationSchema = z.object({
  /** The agent raising the escalation */
  fromAgentId: z.string().min(1, 'fromAgentId is required'),
  /** Severity level: warning | critical | blocker */
  severity: z.enum(ESCALATION_SEVERITIES, {
    error: `severity must be one of: ${ESCALATION_SEVERITIES.join(', ')}`,
  }),
  /** Category for grouping (e.g. "security", "infra", "product", "budget") */
  category: z.string().min(1, 'category is required'),
  /** Short descriptive title */
  title: z.string().min(1, 'title is required'),
  /** Optional longer description with context */
  description: z.string().optional(),
});

export type CreateEscalationInput = z.infer<typeof CreateEscalationSchema>;

/**
 * Schema for updating an escalation (resolve, dismiss, acknowledge).
 */
export const UpdateEscalationSchema = z.object({
  /** The escalation's database UUID */
  id: z.string().uuid('id must be a valid UUID'),
  /** New status: acknowledged | resolved | dismissed */
  status: z.string().optional(),
  /** Who resolved it (agent ID or "dustin") */
  resolvedBy: z.string().optional(),
  /** Resolution notes */
  resolution: z.string().optional(),
});

export type UpdateEscalationInput = z.infer<typeof UpdateEscalationSchema>;

// =============================================================================
// MESSAGES
// =============================================================================

/**
 * Schema for logging a message to the MessageLog.
 *
 * The MessageLog is the audit trail for all inter-agent and agent-human
 * communication. Every wake, escalation, and explicit comms_log call
 * creates a record here.
 *
 * Channels: "schedule", "escalation", "kick", "report", "direct"
 *
 * @example
 * ```json
 * {
 *   "fromId": "captain",
 *   "toId": "rocket",
 *   "channel": "report",
 *   "body": "ShipLog daily: 3 tasks complete, 1 blocked"
 * }
 * ```
 */
export const CreateMessageSchema = z.object({
  /** Sender identifier (agent ID, "orchestrator", "dustin") */
  fromId: z.string().min(1, 'fromId is required'),
  /** Recipient identifier */
  toId: z.string().min(1, 'toId is required'),
  /** Communication channel (schedule, escalation, kick, report, direct) */
  channel: z.string().min(1, 'channel is required'),
  /** Optional subject line */
  subject: z.string().optional(),
  /** Message body content */
  body: z.string().min(1, 'body is required'),
  /** Delivery status. Default: "sent" */
  status: z.string().default('sent'),
  /** Optional structured metadata (JSON-serializable) */
  metadata: z.any().optional(),
});

export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;

// =============================================================================
// PIPELINES
// =============================================================================

/**
 * Schema for creating an SDLC pipeline with default quality gates.
 *
 * Pipelines enforce the 7-gate quality process:
 *   lint → typecheck → unit_tests → build → security → red_team → pre_ship
 *
 * @example
 * ```json
 * { "projectId": "anti-cpq", "stage": "staging" }
 * ```
 */
export const CreatePipelineSchema = z.object({
  /** Project ID from the Project table */
  projectId: z.string().min(1, 'projectId is required'),
  /** Deployment stage: development | staging | production. Default: "development" */
  stage: z.string().default('development'),
});

export type CreatePipelineInput = z.infer<typeof CreatePipelineSchema>;

/**
 * Schema for updating a pipeline or a specific gate within it.
 *
 * Two modes:
 * 1. **Gate update**: provide `gateId` + `status` to update a specific gate
 * 2. **Pipeline update**: omit `gateId`, provide `status` or `stage`
 *
 * When a gate is updated, the pipeline's overall status is auto-recalculated:
 * - Any hard gate failing → pipeline = "failing"
 * - All gates passing/skipped → pipeline = "passing"
 * - Otherwise → pipeline = "pending"
 */
export const UpdatePipelineSchema = z.object({
  /** Pipeline database UUID */
  id: z.string().uuid('id must be a valid UUID'),
  /** Gate UUID — if provided, this is a gate-level update */
  gateId: z.string().uuid().optional(),
  /** New status for the gate or pipeline */
  status: z.string().optional(),
  /** Gate output / log content */
  output: z.string().optional(),
  /** Who checked this gate (agent ID or "dustin") */
  checkedBy: z.string().optional(),
  /** Pipeline stage update */
  stage: z.string().optional(),
});

export type UpdatePipelineInput = z.infer<typeof UpdatePipelineSchema>;

// =============================================================================
// IDEAS (The Refinery)
// =============================================================================

/** Valid Idea statuses */
export const IDEA_STATUSES = ['draft', 'refining', 'validating', 'validated', 'review_failed', 'graduated', 'killed'] as const;

/** Valid Idea refinery stages */
export const IDEA_STAGES = ['pain_audit', 'copy_draft', 'outreach'] as const;

/**
 * Schema for creating a new idea in the refinery.
 *
 * @example
 * ```json
 * { "id": "IDEA-010", "title": "AI Code Review Bot", "source": "Reddit" }
 * ```
 */
export const CreateIdeaSchema = z.object({
  /** Idea ID (e.g. "IDEA-010") */
  id: z.string().min(1, 'id is required'),
  /** Idea title */
  title: z.string().min(1, 'title is required'),
  /** High-level pitch */
  description: z.string().optional(),
  /** Origin source */
  source: z.string().optional(),
  /** Initial score (0-100) */
  score: z.number().min(0).max(100).optional(),
});

export type CreateIdeaInput = z.infer<typeof CreateIdeaSchema>;

/**
 * Schema for updating an idea's refinery state.
 *
 * Two modes:
 * 1. **Field update**: update status, stage, refineryData, validationMetrics
 * 2. **Start sprint**: set `action: "start_sprint"` to begin a 48h validation window
 */
export const UpdateIdeaSchema = z.object({
  /** Idea ID */
  id: z.string().min(1, 'id is required'),
  /** Action: "start_sprint" to begin validation, "graduate" to promote, "kill" to archive */
  action: z.enum(['start_sprint', 'graduate', 'kill']).optional(),
  /** New status */
  status: z.enum(IDEA_STATUSES).optional(),
  /** Refinery sub-stage */
  stage: z.enum(IDEA_STAGES).optional(),
  /** Agent-populated research data */
  refineryData: z.any().optional(),
  /** Live validation metrics */
  validationMetrics: z.any().optional(),
  /** Sprint duration in hours (default 48) — only used with action: "start_sprint" */
  sprintDurationHours: z.number().min(1).max(168).optional(),
  /** Signup target — only used with action: "start_sprint" */
  validationTarget: z.number().int().min(1).optional(),
  /** Score override */
  score: z.number().min(0).max(100).optional(),
  /** Research notes */
  researchNotes: z.string().optional(),
});

export type UpdateIdeaInput = z.infer<typeof UpdateIdeaSchema>;

// =============================================================================
// CARPLAY
// =============================================================================

/** Valid CarPlay alert severity levels (P0 = driving interrupt, P1 = quiet, P2 = badge) */
export const CARPLAY_ALERT_SEVERITIES = [0, 1, 2] as const;

/** Valid CarPlay alert source types */
export const CARPLAY_ALERT_TYPES = ['ci', 'prod', 'outreach', 'security', 'stripe', 'fleet', 'pr'] as const;

/** Allowlisted CarPlay remote actions */
export const CARPLAY_ACTIONS = ['pause_outreach', 'resume_outreach', 'kick_rocket'] as const;

/** Valid CarPlay message sources */
export const CARPLAY_SOURCES = ['carplay', 'siri'] as const;

/**
 * Schema for acknowledging a CarPlay alert.
 *
 * @example
 * ```json
 * { "alertId": "a1b2c3d4-e5f6-..." }
 * ```
 */
export const AckAlertSchema = z.object({
  /** The CarPlayAlert UUID to acknowledge */
  alertId: z.string().uuid('alertId must be a valid UUID'),
});

export type AckAlertInput = z.infer<typeof AckAlertSchema>;

/**
 * Schema for performing a car-safe action.
 *
 * Actions are allowlisted to prevent misuse on the remote surface:
 * - `pause_outreach` — disable outreach schedules
 * - `resume_outreach` — re-enable outreach schedules
 * - `kick_rocket` — wake Rocket for an immediate action
 *
 * @example
 * ```json
 * { "action": "kick_rocket", "context": "Check CompIQ deploy" }
 * ```
 */
export const CarPlayActionSchema = z.object({
  /** The action to perform (must be in the allowlist) */
  action: z.enum(CARPLAY_ACTIONS, {
    error: `action must be one of: ${CARPLAY_ACTIONS.join(', ')}`,
  }),
  /** Optional context for the action (e.g., message to Rocket on kick) */
  context: z.string().max(500).optional(),
});

export type CarPlayActionInput = z.infer<typeof CarPlayActionSchema>;

/**
 * Schema for sending a message to Rocket via CarPlay/Siri.
 *
 * The backend will request a two-output response from Rocket:
 * `[CARPLAY]` digest (≤480 chars) + `[FULL]` detailed response.
 *
 * @example
 * ```json
 * { "text": "What's the status of CompIQ?", "source": "siri" }
 * ```
 */
export const CarPlayMessageSchema = z.object({
  /** The dictated message text */
  text: z.string().min(1, 'text is required').max(2000),
  /** Where the message originated */
  source: z.enum(CARPLAY_SOURCES, {
    error: `source must be one of: ${CARPLAY_SOURCES.join(', ')}`,
  }),
});

export type CarPlayMessageInput = z.infer<typeof CarPlayMessageSchema>;

/**
 * Schema for initial device pairing (POST /api/carplay/auth).
 *
 * The device sends its unique identifier and a shared secret.
 * On success, it receives an access + refresh token pair.
 */
export const CarPlayAuthSchema = z.object({
  /** SHA256 of the device's unique identifier */
  deviceId: z.string().min(1, 'deviceId is required'),
  /** Shared secret (must match CARPLAY_DEVICE_SECRET env var) */
  secret: z.string().min(1, 'secret is required'),
});

export type CarPlayAuthInput = z.infer<typeof CarPlayAuthSchema>;

/**
 * Schema for refreshing an expired access token.
 */
export const CarPlayRefreshSchema = z.object({
  /** The refresh token issued during pairing */
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export type CarPlayRefreshInput = z.infer<typeof CarPlayRefreshSchema>;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Helper to create a standardized 400 error response from a Zod validation failure.
 *
 * @param error - The ZodError from a failed `safeParse` call
 * @returns A flattened error object suitable for JSON response
 *
 * @example
 * ```ts
 * const result = CreateScheduleSchema.safeParse(body);
 * if (!result.success) {
 *   return NextResponse.json(formatZodError(result.error), { status: 400 });
 * }
 * ```
 */
export function formatZodError(error: z.ZodError) {
  return { error: error.flatten() };
}
