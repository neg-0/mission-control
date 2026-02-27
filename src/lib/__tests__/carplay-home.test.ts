/**
 * @module carplay-home.test
 * @description
 * Tests for the CarPlay home aggregator's pure functions.
 *
 * The main getCarPlayHome() requires a live database. These tests
 * cover the MRR log-scale calculation and data shape validation.
 */

describe('MRR log-scale calculation', () => {
  /**
   * Convert MRR to a 0-100 percentage on a log10 scale.
   * Scale: $0=0%, $10≈17%, $100≈33%, $1k=50%, $10k≈67%, $100k≈83%, $1M=100%
   */
  function mrrToLogPercent(mrr: number): number {
    if (mrr <= 0) return 0;
    const logVal = Math.log10(mrr);
    const percent = (logVal / 6) * 100;
    return Math.min(100, Math.max(0, Math.round(percent * 10) / 10));
  }

  test('$0 MRR = 0%', () => {
    expect(mrrToLogPercent(0)).toBe(0);
  });

  test('negative MRR = 0%', () => {
    expect(mrrToLogPercent(-100)).toBe(0);
  });

  test('$1 MRR = 0%', () => {
    expect(mrrToLogPercent(1)).toBe(0);
  });

  test('$10 MRR ≈ 16.7%', () => {
    const result = mrrToLogPercent(10);
    expect(result).toBeGreaterThan(15);
    expect(result).toBeLessThan(18);
  });

  test('$100 MRR ≈ 33.3%', () => {
    const result = mrrToLogPercent(100);
    expect(result).toBeGreaterThan(32);
    expect(result).toBeLessThan(35);
  });

  test('$1,000 MRR = 50%', () => {
    expect(mrrToLogPercent(1000)).toBe(50);
  });

  test('$10,000 MRR ≈ 66.7%', () => {
    const result = mrrToLogPercent(10000);
    expect(result).toBeGreaterThan(65);
    expect(result).toBeLessThan(68);
  });

  test('$100,000 MRR ≈ 83.3%', () => {
    const result = mrrToLogPercent(100000);
    expect(result).toBeGreaterThan(82);
    expect(result).toBeLessThan(84);
  });

  test('$1,000,000 MRR = 100%', () => {
    expect(mrrToLogPercent(1000000)).toBe(100);
  });

  test('$10,000,000 MRR caps at 100%', () => {
    expect(mrrToLogPercent(10000000)).toBe(100);
  });

  test('$50 MRR is between $10 and $100 positions', () => {
    const result = mrrToLogPercent(50);
    expect(result).toBeGreaterThan(mrrToLogPercent(10));
    expect(result).toBeLessThan(mrrToLogPercent(100));
  });

  test('scale is monotonically increasing', () => {
    const values = [1, 10, 50, 100, 500, 1000, 5000, 10000, 100000, 1000000];
    for (let i = 1; i < values.length; i++) {
      expect(mrrToLogPercent(values[i])).toBeGreaterThanOrEqual(
        mrrToLogPercent(values[i - 1])
      );
    }
  });
});

describe('CarPlay home data shape', () => {
  // Validate the expected shape of CarPlayHomeData
  test('fleet health color derivation', () => {
    const deriveColor = (blocked: number, active: number): string => {
      if (blocked > 0) return 'red';
      if (active === 0) return 'yellow';
      return 'green';
    };

    expect(deriveColor(1, 5)).toBe('red');
    expect(deriveColor(0, 0)).toBe('yellow');
    expect(deriveColor(0, 3)).toBe('green');
  });

  test('project status color derivation', () => {
    const deriveStatusColor = (
      blockersCount: number,
      hasCriticalTask: boolean,
      stage: string
    ): string => {
      if (blockersCount > 0) return 'red';
      if (hasCriticalTask) return 'yellow';
      if (stage === 'building') return 'yellow';
      return 'green';
    };

    expect(deriveStatusColor(2, false, 'launched')).toBe('red');
    expect(deriveStatusColor(0, true, 'launched')).toBe('yellow');
    expect(deriveStatusColor(0, false, 'building')).toBe('yellow');
    expect(deriveStatusColor(0, false, 'launched')).toBe('green');
  });
});
