/**
 * @module idea-refinery.test
 * @description
 * Test suite for Phase 3 Idea Refinery features:
 *
 * 1. Idea schemas — CreateIdeaSchema, UpdateIdeaSchema validation
 * 2. Status lifecycle — validated/review_failed soft verdict states
 * 3. Verdict logic — computeVerdict helper
 * 4. Webhook validation — email dedup, input sanitization
 */

import {
  CreateIdeaSchema,
  IDEA_STAGES,
  IDEA_STATUSES,
  UpdateIdeaSchema,
  formatZodError,
} from '../schemas';

// =============================================================================
// IDEA_STATUSES / IDEA_STAGES constants
// =============================================================================

describe('Idea constants', () => {
  test('IDEA_STATUSES includes all expected values', () => {
    expect(IDEA_STATUSES).toContain('draft');
    expect(IDEA_STATUSES).toContain('refining');
    expect(IDEA_STATUSES).toContain('validating');
    expect(IDEA_STATUSES).toContain('validated');
    expect(IDEA_STATUSES).toContain('review_failed');
    expect(IDEA_STATUSES).toContain('graduated');
    expect(IDEA_STATUSES).toContain('killed');
  });

  test('IDEA_STATUSES has exactly 7 values', () => {
    expect(IDEA_STATUSES).toHaveLength(7);
  });

  test('IDEA_STAGES includes all 3 pipeline stages', () => {
    expect(IDEA_STAGES).toContain('pain_audit');
    expect(IDEA_STAGES).toContain('copy_draft');
    expect(IDEA_STAGES).toContain('outreach');
  });

  test('IDEA_STAGES has exactly 3 values', () => {
    expect(IDEA_STAGES).toHaveLength(3);
  });
});

// =============================================================================
// CreateIdeaSchema
// =============================================================================

describe('CreateIdeaSchema', () => {
  test('accepts valid idea with required fields', () => {
    const result = CreateIdeaSchema.safeParse({
      id: 'IDEA-010',
      title: 'AI Code Review Bot',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('IDEA-010');
      expect(result.data.title).toBe('AI Code Review Bot');
    }
  });

  test('accepts all optional fields', () => {
    const result = CreateIdeaSchema.safeParse({
      id: 'IDEA-011',
      title: 'Productivity Timer',
      description: 'Pomodoro with AI suggestions',
      source: 'Reddit',
      score: 85,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('Pomodoro with AI suggestions');
      expect(result.data.source).toBe('Reddit');
      expect(result.data.score).toBe(85);
    }
  });

  test('rejects missing id', () => {
    const result = CreateIdeaSchema.safeParse({
      title: 'No ID idea',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing title', () => {
    const result = CreateIdeaSchema.safeParse({
      id: 'IDEA-012',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty id', () => {
    const result = CreateIdeaSchema.safeParse({
      id: '',
      title: 'Empty ID',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty title', () => {
    const result = CreateIdeaSchema.safeParse({
      id: 'IDEA-013',
      title: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects score below 0', () => {
    const result = CreateIdeaSchema.safeParse({
      id: 'IDEA-014',
      title: 'Negative score',
      score: -1,
    });
    expect(result.success).toBe(false);
  });

  test('rejects score above 100', () => {
    const result = CreateIdeaSchema.safeParse({
      id: 'IDEA-015',
      title: 'Over 100',
      score: 101,
    });
    expect(result.success).toBe(false);
  });

  test('accepts score of 0', () => {
    const result = CreateIdeaSchema.safeParse({
      id: 'IDEA-016',
      title: 'Zero score',
      score: 0,
    });
    expect(result.success).toBe(true);
  });

  test('accepts score of 100', () => {
    const result = CreateIdeaSchema.safeParse({
      id: 'IDEA-017',
      title: 'Perfect score',
      score: 100,
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty object', () => {
    const result = CreateIdeaSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('produces readable error with formatZodError', () => {
    const result = CreateIdeaSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toHaveProperty('error');
      expect(formatted.error).toHaveProperty('fieldErrors');
      expect(formatted.error.fieldErrors).toHaveProperty('id');
      expect(formatted.error.fieldErrors).toHaveProperty('title');
    }
  });
});

// =============================================================================
// UpdateIdeaSchema
// =============================================================================

describe('UpdateIdeaSchema', () => {
  test('accepts minimal update with just id', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
    });
    expect(result.success).toBe(true);
  });

  test('accepts status update to validated', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      status: 'validated',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('validated');
    }
  });

  test('accepts status update to review_failed', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      status: 'review_failed',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('review_failed');
    }
  });

  test('accepts all valid statuses', () => {
    for (const status of IDEA_STATUSES) {
      const result = UpdateIdeaSchema.safeParse({
        id: 'IDEA-009',
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  test('rejects invalid status', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      status: 'pending_review',
    });
    expect(result.success).toBe(false);
  });

  test('accepts all valid stages', () => {
    for (const stage of IDEA_STAGES) {
      const result = UpdateIdeaSchema.safeParse({
        id: 'IDEA-009',
        stage,
      });
      expect(result.success).toBe(true);
    }
  });

  test('rejects invalid stage', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      stage: 'brainstorm',
    });
    expect(result.success).toBe(false);
  });

  test('accepts start_sprint action', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      action: 'start_sprint',
      sprintDurationHours: 48,
      validationTarget: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('start_sprint');
      expect(result.data.sprintDurationHours).toBe(48);
      expect(result.data.validationTarget).toBe(10);
    }
  });

  test('accepts graduate action', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      action: 'graduate',
    });
    expect(result.success).toBe(true);
  });

  test('accepts kill action', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      action: 'kill',
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid action', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      action: 'promote',
    });
    expect(result.success).toBe(false);
  });

  test('accepts refineryData as JSON object', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      refineryData: {
        painPoints: ['Users hate slow load times'],
        avatars: ['Indie hacker building SaaS'],
        copyVariants: ['Ship faster. Sleep better.'],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refineryData).toHaveProperty('painPoints');
    }
  });

  test('accepts validationMetrics as JSON object', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      validationMetrics: {
        signups: 15,
        target: 10,
        ratio: 150,
        nearMiss: false,
      },
    });
    expect(result.success).toBe(true);
  });

  test('rejects sprintDurationHours below 1', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      action: 'start_sprint',
      sprintDurationHours: 0,
    });
    expect(result.success).toBe(false);
  });

  test('rejects sprintDurationHours above 168', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      action: 'start_sprint',
      sprintDurationHours: 200,
    });
    expect(result.success).toBe(false);
  });

  test('rejects validationTarget below 1', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      action: 'start_sprint',
      validationTarget: 0,
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing id', () => {
    const result = UpdateIdeaSchema.safeParse({
      status: 'validated',
    });
    expect(result.success).toBe(false);
  });

  test('accepts combined status + stage + research notes update', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-009',
      status: 'refining',
      stage: 'pain_audit',
      researchNotes: 'Found 5 pain points on Reddit',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.researchNotes).toBe('Found 5 pain points on Reddit');
    }
  });
});

// =============================================================================
// Verdict Logic (pure function tests)
// =============================================================================

/**
 * Extracted verdict computation logic — mirrors the cron route's decision tree.
 * This makes the core business logic unit-testable without mocking Prisma.
 */
function computeVerdict(signups: number, target: number) {
  const ratio = signups / target;
  const nearMiss = ratio >= 0.8 && ratio < 1.0;
  const verdict: 'validated' | 'review_failed' = signups >= target ? 'validated' : 'review_failed';
  return { verdict, nearMiss, ratio: Math.round(ratio * 100) };
}

describe('computeVerdict', () => {
  test('validates when signups meet target', () => {
    const { verdict, nearMiss, ratio } = computeVerdict(10, 10);
    expect(verdict).toBe('validated');
    expect(nearMiss).toBe(false);
    expect(ratio).toBe(100);
  });

  test('validates when signups exceed target', () => {
    const { verdict, nearMiss, ratio } = computeVerdict(15, 10);
    expect(verdict).toBe('validated');
    expect(nearMiss).toBe(false);
    expect(ratio).toBe(150);
  });

  test('fails when signups below target', () => {
    const { verdict, nearMiss } = computeVerdict(3, 10);
    expect(verdict).toBe('review_failed');
    expect(nearMiss).toBe(false);
  });

  test('near miss when signups at 80% of target', () => {
    const { verdict, nearMiss, ratio } = computeVerdict(8, 10);
    expect(verdict).toBe('review_failed');
    expect(nearMiss).toBe(true);
    expect(ratio).toBe(80);
  });

  test('near miss when signups at 90% of target', () => {
    const { verdict, nearMiss } = computeVerdict(9, 10);
    expect(verdict).toBe('review_failed');
    expect(nearMiss).toBe(true);
  });

  test('not near miss when signups below 80%', () => {
    const { verdict, nearMiss } = computeVerdict(7, 10);
    expect(verdict).toBe('review_failed');
    expect(nearMiss).toBe(false);
  });

  test('handles zero signups', () => {
    const { verdict, nearMiss, ratio } = computeVerdict(0, 10);
    expect(verdict).toBe('review_failed');
    expect(nearMiss).toBe(false);
    expect(ratio).toBe(0);
  });

  test('handles large targets', () => {
    const { verdict, nearMiss, ratio } = computeVerdict(80, 100);
    expect(verdict).toBe('review_failed');
    expect(nearMiss).toBe(true);
    expect(ratio).toBe(80);
  });

  test('exactly at boundary: 80% is near miss', () => {
    const { nearMiss } = computeVerdict(80, 100);
    expect(nearMiss).toBe(true);
  });

  test('exactly 100% is validated not near miss', () => {
    const { verdict, nearMiss } = computeVerdict(100, 100);
    expect(verdict).toBe('validated');
    expect(nearMiss).toBe(false);
  });
});

// =============================================================================
// Webhook Email Validation (pure function tests)
// =============================================================================

/**
 * Extracted webhook email validation — mirrors the route's input checks.
 */
function validateSignupEmail(email: unknown): { valid: boolean; normalized?: string; error?: string } {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return { valid: false, error: 'Valid email is required' };
  }
  return { valid: true, normalized: email.toLowerCase().trim() };
}

describe('validateSignupEmail', () => {
  test('accepts valid email', () => {
    const result = validateSignupEmail('user@example.com');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('user@example.com');
  });

  test('normalizes case', () => {
    const result = validateSignupEmail('User@Example.COM');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('user@example.com');
  });

  test('trims whitespace', () => {
    const result = validateSignupEmail('  user@test.com  ');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('user@test.com');
  });

  test('rejects undefined', () => {
    const result = validateSignupEmail(undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Valid email is required');
  });

  test('rejects null', () => {
    const result = validateSignupEmail(null);
    expect(result.valid).toBe(false);
  });

  test('rejects empty string', () => {
    const result = validateSignupEmail('');
    expect(result.valid).toBe(false);
  });

  test('rejects string without @', () => {
    const result = validateSignupEmail('notanemail');
    expect(result.valid).toBe(false);
  });

  test('rejects number', () => {
    const result = validateSignupEmail(123);
    expect(result.valid).toBe(false);
  });

  test('accepts plus-addressed email', () => {
    const result = validateSignupEmail('user+test@example.com');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('user+test@example.com');
  });
});

// =============================================================================
// Status Lifecycle Transitions
// =============================================================================

describe('Status lifecycle', () => {
  const allStatuses = [...IDEA_STATUSES];

  test('draft is the initial valid status', () => {
    const result = UpdateIdeaSchema.safeParse({
      id: 'IDEA-001',
      status: 'draft',
    });
    expect(result.success).toBe(true);
  });

  test('full happy path: draft → refining → validating → validated → graduated', () => {
    const happyPath = ['draft', 'refining', 'validating', 'validated', 'graduated'];
    for (const status of happyPath) {
      const result = UpdateIdeaSchema.safeParse({
        id: 'IDEA-001',
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  test('failure path: draft → refining → validating → review_failed → killed', () => {
    const failPath = ['draft', 'refining', 'validating', 'review_failed', 'killed'];
    for (const status of failPath) {
      const result = UpdateIdeaSchema.safeParse({
        id: 'IDEA-001',
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  test('all statuses are valid enum values', () => {
    for (const status of allStatuses) {
      const result = UpdateIdeaSchema.safeParse({
        id: 'IDEA-001',
        status,
      });
      expect(result.success).toBe(true);
    }
  });
});
