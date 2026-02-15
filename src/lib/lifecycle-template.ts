/**
 * @module lifecycle-template
 * @description
 * Default SaaS lifecycle template for AI-native speed-run development.
 *
 * 4 phases: idea → ship → live → scale
 *
 * Each phase has checkpoints — binary pass/fail gates that determine if
 * the CEO can advance. Some are automated (system resolves), some require
 * Dustin (humanRequired).
 *
 * Rocket can edit this file to update the default template.
 * When a project graduates from idea, `seedCheckpoints(projectId)` creates
 * all checkpoints from this template.
 */

import { prisma } from '@/lib/prisma';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckpointTemplate {
  phase: 'idea' | 'ship' | 'live' | 'scale';
  key: string;
  label: string;
  order: number;
  automated?: boolean;
  humanRequired?: boolean;
}

// ---------------------------------------------------------------------------
// Lifecycle Phases (display metadata)
// ---------------------------------------------------------------------------

export const LIFECYCLE_PHASES = [
  { key: 'idea', label: 'Idea', emoji: '💡', color: 'text-violet-400', bg: 'bg-violet-500/20' },
  { key: 'ship', label: 'Ship', emoji: '🚀', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  { key: 'live', label: 'Live', emoji: '🟢', color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
  { key: 'scale', label: 'Scale', emoji: '📈', color: 'text-amber-400', bg: 'bg-amber-500/20' },
] as const;

// ---------------------------------------------------------------------------
// Default Checkpoint Template
// ---------------------------------------------------------------------------

export const LIFECYCLE_TEMPLATE: CheckpointTemplate[] = [
  // ── IDEA ──────────────────────────────────────────────────────────────
  { phase: 'idea', key: 'research_brief', label: 'Research brief written', order: 1, automated: true },
  { phase: 'idea', key: 'score_pass', label: 'Score ≥ 70', order: 2, automated: true },
  { phase: 'idea', key: 'human_greenlight', label: 'Human green-light', order: 3, humanRequired: true },

  // ── SHIP ──────────────────────────────────────────────────────────────
  { phase: 'ship', key: 'repo_created', label: 'Repo + core feature working', order: 10, automated: true },
  { phase: 'ship', key: 'db_provisioned', label: 'Database provisioned', order: 11, automated: true },
  { phase: 'ship', key: 'deployed_preview', label: 'Deployed to preview URL', order: 12, automated: true },
  { phase: 'ship', key: 'gate_builds', label: 'Builds cleanly', order: 13, automated: true },
  { phase: 'ship', key: 'gate_tests', label: 'Tests pass', order: 14, automated: true },
  { phase: 'ship', key: 'dead_ui_scan', label: 'No dead-end UI elements', order: 15, automated: true },
  { phase: 'ship', key: 'design_consistency', label: 'Design system compliance', order: 16, automated: true },
  { phase: 'ship', key: 'gate_security', label: 'Security scan clear', order: 17, automated: true },
  { phase: 'ship', key: 'human_review', label: 'Human review of live preview', order: 18, humanRequired: true },

  // ── LIVE ──────────────────────────────────────────────────────────────
  { phase: 'live', key: 'custom_domain', label: 'Custom domain configured', order: 20, automated: true },
  { phase: 'live', key: 'first_user', label: 'First real user', order: 21, automated: true },
  { phase: 'live', key: 'payments', label: 'Payment integration', order: 22, automated: true },
  { phase: 'live', key: 'monitoring', label: 'Monitoring + alerting active', order: 23, automated: true },

  // ── SCALE ─────────────────────────────────────────────────────────────
  { phase: 'scale', key: 'mrr_positive', label: 'MRR > $0', order: 30, automated: true },
  { phase: 'scale', key: 'marketing_page', label: 'Marketing page live', order: 31, automated: true },
  { phase: 'scale', key: 'ten_users', label: '10+ active users', order: 32, automated: true },
];

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------

/**
 * Seed all lifecycle checkpoints for a project from the default template.
 * Skips any checkpoints that already exist (upsert by projectId+key).
 */
export async function seedCheckpoints(projectId: string): Promise<number> {
  let created = 0;

  for (const tmpl of LIFECYCLE_TEMPLATE) {
    const existing = await prisma.checkpoint.findUnique({
      where: { projectId_key: { projectId, key: tmpl.key } },
    });

    if (!existing) {
      await prisma.checkpoint.create({
        data: {
          projectId,
          phase: tmpl.phase,
          key: tmpl.key,
          label: tmpl.label,
          order: tmpl.order,
          automated: tmpl.automated ?? false,
          humanRequired: tmpl.humanRequired ?? false,
        },
      });
      created++;
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Auto-Promotion Logic
// ---------------------------------------------------------------------------

const PHASE_TO_STAGE_MAP: Record<string, string> = {
  idea: 'research',
  ship: 'beta',
  live: 'launched',
  scale: 'launched', // No stage beyond launched
};

const STAGE_ORDER = ['backlog', 'research', 'building', 'beta', 'launched'];

/**
 * Check if a project should be auto-promoted to the next stage based on passed checkpoints.
 * Only promotes forward.
 */
export async function maybePromoteProject(projectId: string): Promise<{
  promoted: boolean;
  oldStage?: string;
  newStage?: string;
  reason?: string;
}> {
  // 1. Get project and checkpoints
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { checkpoints: true },
  });

  if (!project) return { promoted: false };

  // 2. Determine highest completed phase
  // We check phases in order. If a phase is fully passed, we consider it "complete".
  let completedPhase: string | null = null;

  for (const phase of LIFECYCLE_PHASES) {
    const phaseCheckpoints = project.checkpoints.filter(c => c.phase === phase.key);
    
    // If phase has no checkpoints, we can't complete it (safety check)
    if (phaseCheckpoints.length === 0) continue;

    const allPassed = phaseCheckpoints.every(
      c => c.status === 'pass' || c.status === 'skipped'
    );

    if (allPassed) {
      completedPhase = phase.key;
    } else {
      // If this phase isn't complete, we stop checking subsequent phases
      // (You can't complete 'live' if 'ship' isn't complete)
      break;
    }
  }

  if (!completedPhase) return { promoted: false };

  // 3. Determine target stage
  const targetStage = PHASE_TO_STAGE_MAP[completedPhase];
  if (!targetStage) return { promoted: false };

  // 4. Check ordinality (only promote forward)
  const currentIdx = STAGE_ORDER.indexOf(project.stage);
  const targetIdx = STAGE_ORDER.indexOf(targetStage);

  if (targetIdx > currentIdx) {
    await prisma.project.update({
      where: { id: projectId },
      data: { stage: targetStage },
    });

    return {
      promoted: true,
      oldStage: project.stage,
      newStage: targetStage,
      reason: `Completed ${completedPhase} phase`,
    };
  }

  return { promoted: false };
}
