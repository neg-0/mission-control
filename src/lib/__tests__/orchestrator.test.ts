/**
 * @module orchestrator.test
 * @description
 * Test suite for the Mission Control orchestrator's cron expression parser.
 *
 * Tests cover:
 * - parseCronField: wildcards, steps, comma lists, ranges, single values, edge cases
 * - getNextCronRun: various cron expressions, midnight rollover, month boundaries,
 *   day-of-week filtering, fallback behavior for unparseable expressions
 */

import { getNextCronRun, parseCronField } from '../orchestrator';

// =============================================================================
// parseCronField
// =============================================================================

describe('parseCronField', () => {
  test('wildcard * returns all values in range', () => {
    const result = parseCronField('*', 0, 59);
    expect(result).toHaveLength(60);
    expect(result[0]).toBe(0);
    expect(result[59]).toBe(59);
  });

  test('wildcard for months (1-12)', () => {
    const result = parseCronField('*', 1, 12);
    expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('step value */5 for minutes', () => {
    const result = parseCronField('*/5', 0, 59);
    expect(result).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  test('step value */2 for hours', () => {
    const result = parseCronField('*/2', 0, 23);
    expect(result).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  });

  test('step value */15 for minutes', () => {
    const result = parseCronField('*/15', 0, 59);
    expect(result).toEqual([0, 15, 30, 45]);
  });

  test('comma-separated values', () => {
    const result = parseCronField('1,3,5', 0, 6);
    expect(result).toEqual([1, 3, 5]);
  });

  test('comma-separated filters out values outside range', () => {
    const result = parseCronField('0,5,60,99', 0, 59);
    expect(result).toEqual([0, 5]);
  });

  test('range N-M for weekdays', () => {
    const result = parseCronField('1-5', 0, 6);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  test('range respects min/max bounds', () => {
    const result = parseCronField('0-31', 1, 31);
    expect(result).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  test('single value', () => {
    const result = parseCronField('30', 0, 59);
    expect(result).toEqual([30]);
  });

  test('single value 0', () => {
    const result = parseCronField('0', 0, 59);
    expect(result).toEqual([0]);
  });

  test('invalid step returns min', () => {
    const result = parseCronField('*/abc', 0, 59);
    expect(result).toEqual([0]);
  });

  test('invalid value returns min', () => {
    const result = parseCronField('abc', 0, 59);
    expect(result).toEqual([0]);
  });
});

// =============================================================================
// getNextCronRun
// =============================================================================

describe('getNextCronRun', () => {
  test('every minute (* * * * *) returns next minute', () => {
    // Use local-time constructor — getNextCronRun uses local getHours/getMinutes
    const after = new Date(2026, 1, 12, 14, 30, 0);
    const next = getNextCronRun('* * * * *', after);
    expect(next.getMinutes()).toBe(31);
    expect(next.getHours()).toBe(14);
  });

  test('specific minute and hour (30 9 * * *)', () => {
    const after = new Date(2026, 1, 12, 8, 0, 0);
    const next = getNextCronRun('30 9 * * *', after);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
    expect(next.getDate()).toBe(12); // same day
  });

  test('specific minute and hour already passed → next day', () => {
    const after = new Date(2026, 1, 12, 10, 0, 0);
    const next = getNextCronRun('30 9 * * *', after);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
    expect(next.getDate()).toBe(13); // next day
  });

  test('midnight rollover (0 0 * * *)', () => {
    const after = new Date(2026, 1, 12, 23, 59, 0);
    const next = getNextCronRun('0 0 * * *', after);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(13);
  });

  test('every 2 hours (0 */2 * * *)', () => {
    const after = new Date(2026, 1, 12, 15, 30, 0);
    const next = getNextCronRun('0 */2 * * *', after);
    expect(next.getHours()).toBe(16);
    expect(next.getMinutes()).toBe(0);
  });

  test('weekday filter (30 9 * * 1-5) skips weekends', () => {
    // Saturday Feb 14, 2026 → should skip to Monday Feb 16
    const saturday = new Date(2026, 1, 14, 10, 0, 0);
    const next = getNextCronRun('30 9 * * 1-5', saturday);
    expect(next.getDay()).toBeGreaterThanOrEqual(1);
    expect(next.getDay()).toBeLessThanOrEqual(5);
  });

  test('first of month (0 0 1 * *)', () => {
    // Use explicit local-time date to avoid timezone mismatch
    const after = new Date(2026, 1, 12, 0, 0, 0); // Feb 12, 2026 local time
    const next = getNextCronRun('0 0 1 * *', after);
    expect(next.getTime()).toBeGreaterThan(after.getTime());
    // getNextCronRun uses local getDate/getHours
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
  });

  test('step minutes (*/15 * * * *)', () => {
    const after = new Date(2026, 1, 12, 14, 1, 0);
    const next = getNextCronRun('*/15 * * * *', after);
    expect(next.getMinutes()).toBe(15);
    expect(next.getHours()).toBe(14);
  });

  test('comma-separated minutes (0,30 * * * *)', () => {
    const after = new Date(2026, 1, 12, 14, 5, 0);
    const next = getNextCronRun('0,30 * * * *', after);
    expect(next.getMinutes()).toBe(30);
    expect(next.getHours()).toBe(14);
  });

  test('invalid expression (too few fields) falls back to 1 hour', () => {
    const after = new Date(2026, 1, 12, 14, 0, 0);
    const next = getNextCronRun('bad cron', after);
    const expectedMs = after.getTime() + 3600000;
    expect(next.getTime()).toBe(expectedMs);
  });

  test('empty expression falls back to 1 hour', () => {
    const after = new Date(2026, 1, 12, 14, 0, 0);
    const next = getNextCronRun('', after);
    expect(next.getTime()).toBe(after.getTime() + 3600000);
  });

  test('next run is always strictly after the reference time', () => {
    const after = new Date(2026, 1, 12, 14, 30, 0);
    const next = getNextCronRun('30 14 * * *', after);
    // Should be tomorrow at 14:30, not today (since we're AT 14:30)
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });

  test('Sunday filter (0 10 * * 0)', () => {
    // Feb 12, 2026 is Thursday → next Sunday is Feb 15
    const thursday = new Date(2026, 1, 12, 11, 0, 0);
    const next = getNextCronRun('0 10 * * 0', thursday);
    expect(next.getDay()).toBe(0); // Sunday
    expect(next.getHours()).toBe(10);
    expect(next.getMinutes()).toBe(0);
  });
});
