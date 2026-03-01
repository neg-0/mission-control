/**
 * @module pipeline
 * @description
 * Pure business logic for the Mission Control SDLC pipeline system.
 *
 * The pipeline enforces a 7-gate quality process before code reaches production:
 *
 * ```
 * lint → typecheck → unit_tests → build → security → red_team → pre_ship
 * ```
 *
 * Each gate has a **severity** that determines how failures affect the pipeline:
 * - `hard` — a failing hard gate **blocks** the pipeline (status = "failing")
 * - `soft` — a failing soft gate generates a warning but doesn't block
 *
 * ## Pipeline Status Calculation
 *
 * The pipeline's overall status is automatically derived from its gates:
 *
 * | Gate States                        | Pipeline Status |
 * |------------------------------------|-----------------|
 * | Any hard gate = "failing"          | `failing`       |
 * | All gates = "passing" or "skipped" | `passing`       |
 * | Otherwise                          | `pending`       |
 *
 * ## Usage
 *
 * ```ts
 * import { calculatePipelineStatus, DEFAULT_GATES } from '@/lib/pipeline';
 *
 * const status = calculatePipelineStatus(gates);
 * // Returns: 'pending' | 'passing' | 'failing'
 * ```
 */

/**
 * Represents a quality gate's state for status calculation.
 *
 * This is a minimal projection of the full PipelineGate model — only the
 * fields needed for status calculation are included.
 */
export interface GateState {
  /** Gate status: "pending", "passing", "failing", or "skipped" */
  status: string;
  /** Severity level: "hard" gates block the pipeline, "soft" gates only warn */
  severity: string;
}

/**
 * Default quality gates created for every new pipeline.
 *
 * Gate order and severity rationale:
 * 1. **lint** (soft) — style issues shouldn't block deploys
 * 2. **typecheck** (hard) — type errors = broken builds
 * 3. **unit_tests** (hard) — regressions must not ship
 * 4. **build** (hard) — if it doesn't build, it doesn't ship
 * 5. **security** (hard) — no known vulns in production
 * 6. **red_team** (hard) — adversarial review
 * 7. **pre_ship** (hard) — final human approval
 */
export const DEFAULT_GATES: ReadonlyArray<{
  name: string;
  order: number;
  severity: 'soft' | 'hard';
  required: boolean;
}> = [
    { name: 'lint', order: 1, severity: 'soft', required: false },
    { name: 'typecheck', order: 2, severity: 'hard', required: true },
    { name: 'unit_tests', order: 3, severity: 'hard', required: true },
    { name: 'build', order: 4, severity: 'hard', required: true },
    { name: 'security', order: 5, severity: 'hard', required: true },
    { name: 'red_team', order: 6, severity: 'hard', required: true },
    { name: 'pre_ship', order: 7, severity: 'hard', required: true },
  ];

/**
 * Calculates the overall pipeline status from its constituent gates.
 *
 * Rules (evaluated in priority order):
 * 1. If ANY gate with `severity: "hard"` has `status: "failing"` → pipeline is `"failing"`
 * 2. If ALL gates have `status: "passing"` or `status: "skipped"` → pipeline is `"passing"`
 * 3. Otherwise → pipeline is `"pending"`
 *
 * @param gates - Array of gate states to evaluate
 * @returns The calculated pipeline status: "pending", "passing", or "failing"
 *
 * @example
 * ```ts
 * // All passing → "passing"
 * calculatePipelineStatus([
 *   { status: 'passing', severity: 'soft' },
 *   { status: 'passing', severity: 'hard' },
 * ]); // → "passing"
 *
 * // Hard gate failing → "failing"
 * calculatePipelineStatus([
 *   { status: 'passing', severity: 'soft' },
 *   { status: 'failing', severity: 'hard' },
 * ]); // → "failing"
 *
 * // Soft gate failing, no hard failures → "passing" (soft gates don't block)
 * calculatePipelineStatus([
 *   { status: 'failing', severity: 'soft' },
 *   { status: 'passing', severity: 'hard' },
 * ]); // → "passing"
 * ```
 */
export function calculatePipelineStatus(gates: GateState[]): 'pending' | 'passing' | 'failing' {
  // Empty gates = pipeline hasn't started
  if (gates.length === 0) return 'pending';

  // Rule 1: Any hard gate failing → pipeline fails
  const hardFailing = gates.some(
    (g) => g.severity === 'hard' && g.status === 'failing'
  );
  if (hardFailing) return 'failing';

  // Rule 2: All gates resolved (passing, skipped, or soft-failing) → pipeline passes
  // Soft gate failures generate warnings but don't block the pipeline.
  const allResolved = gates.every(
    (g) =>
      g.status === 'passing' ||
      g.status === 'skipped' ||
      (g.status === 'failing' && g.severity === 'soft')
  );
  if (allResolved) return 'passing';

  // Rule 3: Otherwise → still pending
  return 'pending';
}
