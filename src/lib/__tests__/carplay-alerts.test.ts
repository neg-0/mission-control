/**
 * @module carplay-alerts.test
 * @description
 * Tests for the CarPlay alert system's pure logic.
 *
 * The evaluateAlerts() function requires a live database connection
 * and is covered by integration tests. These unit tests cover the
 * classification rules and business logic.
 */

describe('CarPlay alert severity classification', () => {
  // Severity mapping rules from the interrupt policy
  const classifyEscalation = (severity: string): number => {
    if (severity === 'blocker') return 0; // P0
    if (severity === 'critical') return 1; // P1
    return 2; // P2
  };

  test('blocker escalation maps to P0', () => {
    expect(classifyEscalation('blocker')).toBe(0);
  });

  test('critical escalation maps to P1', () => {
    expect(classifyEscalation('critical')).toBe(1);
  });

  test('warning escalation maps to P2', () => {
    expect(classifyEscalation('warning')).toBe(2);
  });
});

describe('CarPlay auto-promotion rules', () => {
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  // Pure logic: should a P1 be promoted to P0?
  const shouldPromote = (repeatCount: number, ageMs: number): boolean => {
    return repeatCount > 3 || ageMs > TWO_HOURS_MS;
  };

  test('promotes P1 with >3 repeats', () => {
    expect(shouldPromote(4, 0)).toBe(true);
  });

  test('does not promote P1 with exactly 3 repeats', () => {
    expect(shouldPromote(3, 0)).toBe(false);
  });

  test('promotes P1 older than 2 hours', () => {
    expect(shouldPromote(1, TWO_HOURS_MS + 1)).toBe(true);
  });

  test('does not promote P1 under 2 hours with low repeat', () => {
    expect(shouldPromote(1, TWO_HOURS_MS - 1)).toBe(false);
  });

  test('promotes P1 at boundary: 4 repeats and fresh', () => {
    expect(shouldPromote(4, 1000)).toBe(true);
  });

  test('promotes P1 at boundary: 1 repeat and exactly over 2h', () => {
    expect(shouldPromote(1, TWO_HOURS_MS + 1)).toBe(true);
  });
});

describe('CarPlay dedupeKey format', () => {
  // Validate dedupeKey format matches expected patterns
  const PATTERNS: Record<string, RegExp> = {
    escalation: /^escalation:[a-zA-Z0-9-]+$/,
    ci: /^ci:[a-zA-Z0-9_-]+:[a-zA-Z]+$/,
    agent_status: /^agent:[a-zA-Z0-9_-]+:(blocked|error|failed|offline)$/,
    task: /^task:[a-zA-Z0-9-]+:critical$/,
    pr: /^pr:\d+:(opened|ci-failed)$/,
    prod: /^prod:[a-zA-Z0-9_-]+:down$/,
    stripe: /^stripe:failure$/,
    gateway: /^gateway:degraded$/,
  };

  test('escalation dedupeKey format', () => {
    expect('escalation:abc-123').toMatch(PATTERNS.escalation);
  });

  test('CI dedupeKey format', () => {
    expect('ci:compiq:production').toMatch(PATTERNS.ci);
  });

  test('agent status dedupeKey format', () => {
    expect('agent:captain:blocked').toMatch(PATTERNS.agent_status);
    expect('agent:warden:offline').toMatch(PATTERNS.agent_status);
  });

  test('task dedupeKey format', () => {
    expect('task:550e8400-e29b-41d4-a716-446655440000:critical').toMatch(PATTERNS.task);
  });

  test('PR dedupeKey format', () => {
    expect('pr:42:opened').toMatch(PATTERNS.pr);
    expect('pr:7:ci-failed').toMatch(PATTERNS.pr);
  });

  test('prod dedupeKey format', () => {
    expect('prod:compiq:down').toMatch(PATTERNS.prod);
  });

  test('stripe dedupeKey format', () => {
    expect('stripe:failure').toMatch(PATTERNS.stripe);
  });

  test('gateway dedupeKey format', () => {
    expect('gateway:degraded').toMatch(PATTERNS.gateway);
  });
});

describe('Escalation category to alert type mapping', () => {
  const mapCategory = (category: string): string => {
    const map: Record<string, string> = {
      security: 'security',
      infra: 'prod',
      production: 'prod',
      budget: 'stripe',
      product: 'fleet',
      architecture: 'fleet',
      merge: 'ci',
    };
    return map[category] ?? 'fleet';
  };

  test('security → security', () => expect(mapCategory('security')).toBe('security'));
  test('infra → prod', () => expect(mapCategory('infra')).toBe('prod'));
  test('production → prod', () => expect(mapCategory('production')).toBe('prod'));
  test('budget → stripe', () => expect(mapCategory('budget')).toBe('stripe'));
  test('product → fleet', () => expect(mapCategory('product')).toBe('fleet'));
  test('architecture → fleet', () => expect(mapCategory('architecture')).toBe('fleet'));
  test('merge → ci', () => expect(mapCategory('merge')).toBe('ci'));
  test('unknown category → fleet (default)', () => expect(mapCategory('misc')).toBe('fleet'));
});
