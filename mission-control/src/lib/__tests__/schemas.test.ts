/**
 * @module schemas.test
 * @description
 * Test suite for Mission Control Zod validation schemas.
 *
 * Tests verify that each schema:
 * - Accepts valid payloads with correct types
 * - Rejects missing required fields
 * - Rejects invalid values (out-of-range numbers, bad enums)
 * - Enforces business rules (e.g. cronExpr XOR intervalMs)
 * - Applies defaults correctly
 */

import {
  CreateEscalationSchema,
  CreateMessageSchema,
  CreatePipelineSchema,
  CreateScheduleSchema,
  DeleteByIdSchema,
  UpdateEscalationSchema,
  UpdateOrchestratorConfigSchema,
  UpdatePipelineSchema,
  UpdateScheduleSchema,
  formatZodError,
} from '../schemas';

// =============================================================================
// CreateScheduleSchema
// =============================================================================

describe('CreateScheduleSchema', () => {
  test('accepts valid cron schedule', () => {
    const result = CreateScheduleSchema.safeParse({
      agentId: 'rocket',
      name: 'Daily standup',
      cronExpr: '0 9 * * 1-5',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentId).toBe('rocket');
      expect(result.data.enabled).toBe(true); // default
      expect(result.data.priority).toBe(0); // default
    }
  });

  test('accepts valid interval schedule', () => {
    const result = CreateScheduleSchema.safeParse({
      agentId: 'captain',
      name: 'Heartbeat',
      intervalMs: 1800000, // 30 min
    });
    expect(result.success).toBe(true);
  });

  test('rejects when both cronExpr AND intervalMs provided', () => {
    const result = CreateScheduleSchema.safeParse({
      agentId: 'rocket',
      name: 'Conflict',
      cronExpr: '0 9 * * *',
      intervalMs: 60000,
    });
    expect(result.success).toBe(false);
  });

  test('rejects when neither cronExpr nor intervalMs provided', () => {
    const result = CreateScheduleSchema.safeParse({
      agentId: 'rocket',
      name: 'Missing timing',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing agentId', () => {
    const result = CreateScheduleSchema.safeParse({
      name: 'No agent',
      cronExpr: '0 9 * * *',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing name', () => {
    const result = CreateScheduleSchema.safeParse({
      agentId: 'rocket',
      cronExpr: '0 9 * * *',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty agentId', () => {
    const result = CreateScheduleSchema.safeParse({
      agentId: '',
      name: 'Test',
      cronExpr: '0 9 * * *',
    });
    expect(result.success).toBe(false);
  });

  test('rejects intervalMs below 10000', () => {
    const result = CreateScheduleSchema.safeParse({
      agentId: 'rocket',
      name: 'Too fast',
      intervalMs: 5000,
    });
    expect(result.success).toBe(false);
  });

  test('rejects priority above 100', () => {
    const result = CreateScheduleSchema.safeParse({
      agentId: 'rocket',
      name: 'High priority',
      cronExpr: '0 9 * * *',
      priority: 101,
    });
    expect(result.success).toBe(false);
  });

  test('applies defaults for optional fields', () => {
    const result = CreateScheduleSchema.safeParse({
      agentId: 'rocket',
      name: 'Defaults test',
      cronExpr: '0 9 * * *',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe(0);
      expect(result.data.enabled).toBe(true);
    }
  });
});

// =============================================================================
// UpdateScheduleSchema
// =============================================================================

describe('UpdateScheduleSchema', () => {
  test('accepts valid update with only id', () => {
    const result = UpdateScheduleSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  test('accepts update with multiple fields', () => {
    const result = UpdateScheduleSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Updated name',
      enabled: false,
      priority: 10,
    });
    expect(result.success).toBe(true);
  });

  test('rejects non-UUID id', () => {
    const result = UpdateScheduleSchema.safeParse({
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing id', () => {
    const result = UpdateScheduleSchema.safeParse({
      name: 'No ID',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// DeleteByIdSchema
// =============================================================================

describe('DeleteByIdSchema', () => {
  test('accepts valid UUID', () => {
    const result = DeleteByIdSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  test('rejects non-UUID', () => {
    const result = DeleteByIdSchema.safeParse({
      id: 'abc123',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing id', () => {
    const result = DeleteByIdSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// UpdateOrchestratorConfigSchema
// =============================================================================

describe('UpdateOrchestratorConfigSchema', () => {
  test('accepts valid partial update', () => {
    const result = UpdateOrchestratorConfigSchema.safeParse({
      maxWakesPerTick: 5,
    });
    expect(result.success).toBe(true);
  });

  test('accepts multiple fields', () => {
    const result = UpdateOrchestratorConfigSchema.safeParse({
      maxWakesPerTick: 3,
      minIntervalMs: 60000,
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  test('rejects maxWakesPerTick > 20', () => {
    const result = UpdateOrchestratorConfigSchema.safeParse({
      maxWakesPerTick: 21,
    });
    expect(result.success).toBe(false);
  });

  test('rejects maxWakesPerTick < 1', () => {
    const result = UpdateOrchestratorConfigSchema.safeParse({
      maxWakesPerTick: 0,
    });
    expect(result.success).toBe(false);
  });

  test('rejects minIntervalMs < 10000', () => {
    const result = UpdateOrchestratorConfigSchema.safeParse({
      minIntervalMs: 5000,
    });
    expect(result.success).toBe(false);
  });

  test('rejects quotaResetHours < 0.5', () => {
    const result = UpdateOrchestratorConfigSchema.safeParse({
      quotaResetHours: 0.1,
    });
    expect(result.success).toBe(false);
  });

  test('allows null tpmLimit', () => {
    const result = UpdateOrchestratorConfigSchema.safeParse({
      tpmLimit: null,
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty object (no valid fields)', () => {
    const result = UpdateOrchestratorConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// CreateEscalationSchema
// =============================================================================

describe('CreateEscalationSchema', () => {
  test('accepts valid escalation', () => {
    const result = CreateEscalationSchema.safeParse({
      fromAgentId: 'warden',
      severity: 'critical',
      category: 'security',
      title: 'SSL cert expires in 24h',
    });
    expect(result.success).toBe(true);
  });

  test('accepts optional description', () => {
    const result = CreateEscalationSchema.safeParse({
      fromAgentId: 'warden',
      severity: 'blocker',
      category: 'infra',
      title: 'DB down',
      description: 'PostgreSQL connection refused on port 5432',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('PostgreSQL connection refused on port 5432');
    }
  });

  test('rejects invalid severity', () => {
    const result = CreateEscalationSchema.safeParse({
      fromAgentId: 'warden',
      severity: 'high', // not a valid severity
      category: 'security',
      title: 'Bad severity',
    });
    expect(result.success).toBe(false);
  });

  test('accepts all valid severities', () => {
    for (const severity of ['warning', 'critical', 'blocker']) {
      const result = CreateEscalationSchema.safeParse({
        fromAgentId: 'test',
        severity,
        category: 'test',
        title: 'Test',
      });
      expect(result.success).toBe(true);
    }
  });

  test('rejects missing required fields', () => {
    const result = CreateEscalationSchema.safeParse({
      fromAgentId: 'warden',
      // missing severity, category, title
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// UpdateEscalationSchema
// =============================================================================

describe('UpdateEscalationSchema', () => {
  test('accepts valid update', () => {
    const result = UpdateEscalationSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'resolved',
      resolvedBy: 'dustin',
      resolution: 'Renewed the SSL cert',
    });
    expect(result.success).toBe(true);
  });

  test('rejects missing id', () => {
    const result = UpdateEscalationSchema.safeParse({
      status: 'resolved',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// CreateMessageSchema
// =============================================================================

describe('CreateMessageSchema', () => {
  test('accepts valid message', () => {
    const result = CreateMessageSchema.safeParse({
      fromId: 'captain',
      toId: 'rocket',
      channel: 'report',
      body: 'Daily update: 3 tasks complete',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('sent'); // default
    }
  });

  test('accepts optional fields', () => {
    const result = CreateMessageSchema.safeParse({
      fromId: 'orchestrator',
      toId: 'rocket',
      channel: 'schedule',
      subject: 'Daily standup',
      body: 'Scheduled wake',
      metadata: { scheduleId: 'abc-123' },
    });
    expect(result.success).toBe(true);
  });

  test('rejects missing fromId', () => {
    const result = CreateMessageSchema.safeParse({
      toId: 'rocket',
      channel: 'report',
      body: 'Test',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing body', () => {
    const result = CreateMessageSchema.safeParse({
      fromId: 'captain',
      toId: 'rocket',
      channel: 'report',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty channel', () => {
    const result = CreateMessageSchema.safeParse({
      fromId: 'captain',
      toId: 'rocket',
      channel: '',
      body: 'Test',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// CreatePipelineSchema
// =============================================================================

describe('CreatePipelineSchema', () => {
  test('accepts valid pipeline', () => {
    const result = CreatePipelineSchema.safeParse({
      projectId: 'anti-cpq',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stage).toBe('development'); // default
    }
  });

  test('accepts custom stage', () => {
    const result = CreatePipelineSchema.safeParse({
      projectId: 'anti-cpq',
      stage: 'staging',
    });
    expect(result.success).toBe(true);
  });

  test('rejects missing projectId', () => {
    const result = CreatePipelineSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('rejects empty projectId', () => {
    const result = CreatePipelineSchema.safeParse({
      projectId: '',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// UpdatePipelineSchema
// =============================================================================

describe('UpdatePipelineSchema', () => {
  test('accepts pipeline-level update', () => {
    const result = UpdatePipelineSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'passing',
    });
    expect(result.success).toBe(true);
  });

  test('accepts gate-level update', () => {
    const result = UpdatePipelineSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      gateId: '660e8400-e29b-41d4-a716-446655440000',
      status: 'passing',
      checkedBy: 'warden',
    });
    expect(result.success).toBe(true);
  });

  test('rejects missing pipeline id', () => {
    const result = UpdatePipelineSchema.safeParse({
      status: 'passing',
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-UUID gateId', () => {
    const result = UpdatePipelineSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      gateId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// formatZodError helper
// =============================================================================

describe('formatZodError', () => {
  test('returns flattened error structure', () => {
    const result = CreateScheduleSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toHaveProperty('error');
      expect(formatted.error).toHaveProperty('fieldErrors');
      expect(formatted.error).toHaveProperty('formErrors');
    }
  });
});
