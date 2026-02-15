/**
 * @module pipeline.test
 * @description
 * Test suite for the Mission Control SDLC pipeline status calculator.
 *
 * Tests cover:
 * - calculatePipelineStatus: all state combinations (pending, passing, failing)
 * - Soft vs hard gate severity behavior
 * - Edge cases: empty gates, mixed states, skipped gates
 * - DEFAULT_GATES constant validation
 */

import { calculatePipelineStatus, DEFAULT_GATES, GateState } from '../pipeline';

// =============================================================================
// DEFAULT_GATES
// =============================================================================

describe('DEFAULT_GATES', () => {
  test('has exactly 7 gates', () => {
    expect(DEFAULT_GATES).toHaveLength(7);
  });

  test('gates are in correct order', () => {
    const names = DEFAULT_GATES.map((g) => g.name);
    expect(names).toEqual([
      'lint', 'typecheck', 'unit_tests', 'build',
      'security', 'red_team', 'pre_ship',
    ]);
  });

  test('only lint is soft severity', () => {
    const soft = DEFAULT_GATES.filter((g) => g.severity === 'soft');
    expect(soft).toHaveLength(1);
    expect(soft[0].name).toBe('lint');
  });

  test('all hard gates are required', () => {
    const hard = DEFAULT_GATES.filter((g) => g.severity === 'hard');
    expect(hard.every((g) => g.required)).toBe(true);
  });

  test('orders are sequential 1-7', () => {
    const orders = DEFAULT_GATES.map((g) => g.order);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

// =============================================================================
// calculatePipelineStatus
// =============================================================================

describe('calculatePipelineStatus', () => {
  // --- Pending states ---

  test('empty gates → pending', () => {
    expect(calculatePipelineStatus([])).toBe('pending');
  });

  test('all gates pending → pending', () => {
    const gates: GateState[] = [
      { status: 'pending', severity: 'hard' },
      { status: 'pending', severity: 'hard' },
      { status: 'pending', severity: 'soft' },
    ];
    expect(calculatePipelineStatus(gates)).toBe('pending');
  });

  test('mix of passing and pending → pending', () => {
    const gates: GateState[] = [
      { status: 'passing', severity: 'hard' },
      { status: 'pending', severity: 'hard' },
      { status: 'passing', severity: 'soft' },
    ];
    expect(calculatePipelineStatus(gates)).toBe('pending');
  });

  // --- Passing states ---

  test('all gates passing → passing', () => {
    const gates: GateState[] = [
      { status: 'passing', severity: 'hard' },
      { status: 'passing', severity: 'hard' },
      { status: 'passing', severity: 'soft' },
    ];
    expect(calculatePipelineStatus(gates)).toBe('passing');
  });

  test('all gates skipped → passing', () => {
    const gates: GateState[] = [
      { status: 'skipped', severity: 'hard' },
      { status: 'skipped', severity: 'soft' },
    ];
    expect(calculatePipelineStatus(gates)).toBe('passing');
  });

  test('mix of passing and skipped → passing', () => {
    const gates: GateState[] = [
      { status: 'passing', severity: 'hard' },
      { status: 'skipped', severity: 'hard' },
      { status: 'passing', severity: 'soft' },
    ];
    expect(calculatePipelineStatus(gates)).toBe('passing');
  });

  test('soft gate failing + all hard passing → passing', () => {
    const gates: GateState[] = [
      { status: 'failing', severity: 'soft' },
      { status: 'passing', severity: 'hard' },
      { status: 'passing', severity: 'hard' },
    ];
    expect(calculatePipelineStatus(gates)).toBe('passing');
  });

  // --- Failing states ---

  test('hard gate failing → failing', () => {
    const gates: GateState[] = [
      { status: 'passing', severity: 'soft' },
      { status: 'failing', severity: 'hard' },
      { status: 'passing', severity: 'hard' },
    ];
    expect(calculatePipelineStatus(gates)).toBe('failing');
  });

  test('multiple hard gates failing → failing', () => {
    const gates: GateState[] = [
      { status: 'failing', severity: 'hard' },
      { status: 'failing', severity: 'hard' },
      { status: 'passing', severity: 'soft' },
    ];
    expect(calculatePipelineStatus(gates)).toBe('failing');
  });

  test('hard failing overrides even if other gates are passing', () => {
    const gates: GateState[] = [
      { status: 'passing', severity: 'hard' },
      { status: 'passing', severity: 'hard' },
      { status: 'passing', severity: 'hard' },
      { status: 'failing', severity: 'hard' },
      { status: 'passing', severity: 'soft' },
    ];
    expect(calculatePipelineStatus(gates)).toBe('failing');
  });

  // --- Realistic scenarios ---

  test('realistic: fresh pipeline with all defaults → pending', () => {
    const gates: GateState[] = DEFAULT_GATES.map((g) => ({
      status: 'pending',
      severity: g.severity,
    }));
    expect(calculatePipelineStatus(gates)).toBe('pending');
  });

  test('realistic: lint failed (soft) but rest pass → passing', () => {
    const gates: GateState[] = [
      { status: 'failing', severity: 'soft' },   // lint
      { status: 'passing', severity: 'hard' },    // typecheck
      { status: 'passing', severity: 'hard' },    // unit_tests
      { status: 'passing', severity: 'hard' },    // build
      { status: 'passing', severity: 'hard' },    // security
      { status: 'passing', severity: 'hard' },    // red_team
      { status: 'passing', severity: 'hard' },    // pre_ship
    ];
    expect(calculatePipelineStatus(gates)).toBe('passing');
  });

  test('realistic: security gate fails → failing despite other passes', () => {
    const gates: GateState[] = [
      { status: 'passing', severity: 'soft' },    // lint
      { status: 'passing', severity: 'hard' },    // typecheck
      { status: 'passing', severity: 'hard' },    // unit_tests
      { status: 'passing', severity: 'hard' },    // build
      { status: 'failing', severity: 'hard' },    // security FAIL
      { status: 'pending', severity: 'hard' },    // red_team
      { status: 'pending', severity: 'hard' },    // pre_ship
    ];
    expect(calculatePipelineStatus(gates)).toBe('failing');
  });
});
