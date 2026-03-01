/**
 * @module orchestrator
 * @description
 * Pure business logic for the Mission Control orchestrator.
 *
 * The orchestrator manages scheduled agent wakes. A host-level cron triggers
 * POST /api/orchestrator/tick every 60 seconds. The tick route queries
 * due schedules, wakes agents via the OpenClaw gateway, and updates timing.
 *
 * This module contains the cron expression parser - the most critical
 * algorithm in the scheduling system. It is extracted here to be independently
 * testable without spinning up an HTTP server or mocking Prisma.
 *
 * Cron Expression Format (standard 5-field):
 *   minute(0-59)  hour(0-23)  day-of-month(1-31)  month(1-12)  day-of-week(0-6, 0=Sun)
 *
 * Supported special characters: star, step (star/N), comma-separated, ranges (N-M)
 */

/**
 * Parses a single cron field into an array of matching values.
 *
 * Supports:
 * - star: all values in the range
 * - star/N: every Nth value starting from min
 * - N,M,O: explicit comma-separated values
 * - N-M: range from N to M inclusive
 * - N: specific single value
 *
 * @param field - The raw cron field string (e.g. "star/5", "1,15", "0-6")
 * @param min - Minimum valid value for this field
 * @param max - Maximum valid value for this field
 * @returns Array of integers this field matches (sorted ascending)
 */
export function parseCronField(field: string, min: number, max: number): number[] {
  // Wildcard - every value
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  // Step values: */N
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step < 1) return [min];
    const result: number[] = [];
    for (let i = min; i <= max; i += step) result.push(i);
    return result;
  }

  // Comma-separated values: N,M,O
  if (field.includes(',')) {
    return field
      .split(',')
      .map((v) => parseInt(v.trim(), 10))
      .filter((v) => !isNaN(v) && v >= min && v <= max)
      .sort((a, b) => a - b);
  }

  // Range: N-M
  if (field.includes('-')) {
    const [startStr, endStr] = field.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end)) return [min];
    const result: number[] = [];
    for (let i = Math.max(start, min); i <= Math.min(end, max); i++) {
      result.push(i);
    }
    return result;
  }

  // Single value
  const val = parseInt(field, 10);
  if (isNaN(val)) return [min];
  return [val];
}

/**
 * Calculates the next run time for a 5-field cron expression.
 *
 * Uses a brute-force minute-by-minute scan starting from after + 1 minute.
 * Searches up to 35 days ahead. If no match is found (e.g. invalid expression),
 * falls back to 24 hours from the reference time.
 *
 * Performance note: Worst case scans 50,400 iterations (35 days of minutes).
 * This is intentionally simple - the orchestrator tick runs at most every 60s
 * with at most 20 schedules, so sub-millisecond performance is not critical.
 *
 * @param expr - 5-field cron expression string
 * @param after - The reference time (typically now). Next run will be strictly after this.
 * @returns The next Date when this cron should fire
 */
export function getNextCronRun(expr: string, after: Date): Date {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) {
    // Unparseable - fallback to 1 hour
    return new Date(after.getTime() + 3600000);
  }

  const [minStr, hourStr, domStr, monStr, dowStr] = parts;

  const minutes = parseCronField(minStr, 0, 59);
  const hours = parseCronField(hourStr, 0, 23);
  const daysOfMonth = parseCronField(domStr, 1, 31);
  const months = parseCronField(monStr, 1, 12);
  const daysOfWeek = parseCronField(dowStr, 0, 6);

  // Start scanning from the next minute after the reference time
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxIterations = 35 * 24 * 60; // 35 days of minutes (handles month boundaries)

  for (let i = 0; i < maxIterations; i++) {
    const m = candidate.getMinutes();
    const h = candidate.getHours();
    const dom = candidate.getDate();
    const mon = candidate.getMonth() + 1;
    const dow = candidate.getDay();

    if (
      minutes.includes(m) &&
      hours.includes(h) &&
      (domStr === '*' || daysOfMonth.includes(dom)) &&
      (monStr === '*' || months.includes(mon)) &&
      (dowStr === '*' || daysOfWeek.includes(dow))
    ) {
      return candidate;
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  // Fallback: couldn't find match in 7 days
  return new Date(after.getTime() + 86400000);
}
