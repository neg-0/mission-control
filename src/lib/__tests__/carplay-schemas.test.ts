/**
 * @module carplay-schemas.test
 * @description
 * Test suite for CarPlay Zod validation schemas.
 */

import {
  AckAlertSchema,
  CarPlayActionSchema,
  CarPlayMessageSchema,
  CarPlayAuthSchema,
  CarPlayRefreshSchema,
} from '../schemas';

// =============================================================================
// AckAlertSchema
// =============================================================================

describe('AckAlertSchema', () => {
  test('accepts valid UUID alertId', () => {
    const result = AckAlertSchema.safeParse({
      alertId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  test('rejects non-UUID alertId', () => {
    const result = AckAlertSchema.safeParse({ alertId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  test('rejects missing alertId', () => {
    const result = AckAlertSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// CarPlayActionSchema
// =============================================================================

describe('CarPlayActionSchema', () => {
  test('accepts pause_outreach', () => {
    const result = CarPlayActionSchema.safeParse({ action: 'pause_outreach' });
    expect(result.success).toBe(true);
  });

  test('accepts resume_outreach', () => {
    const result = CarPlayActionSchema.safeParse({ action: 'resume_outreach' });
    expect(result.success).toBe(true);
  });

  test('accepts kick_rocket with context', () => {
    const result = CarPlayActionSchema.safeParse({
      action: 'kick_rocket',
      context: 'Check CompIQ deploy status',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.context).toBe('Check CompIQ deploy status');
    }
  });

  test('rejects invalid action', () => {
    const result = CarPlayActionSchema.safeParse({ action: 'delete_everything' });
    expect(result.success).toBe(false);
  });

  test('rejects missing action', () => {
    const result = CarPlayActionSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('rejects context over 500 chars', () => {
    const result = CarPlayActionSchema.safeParse({
      action: 'kick_rocket',
      context: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  test('accepts context at exactly 500 chars', () => {
    const result = CarPlayActionSchema.safeParse({
      action: 'kick_rocket',
      context: 'x'.repeat(500),
    });
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// CarPlayMessageSchema
// =============================================================================

describe('CarPlayMessageSchema', () => {
  test('accepts valid carplay message', () => {
    const result = CarPlayMessageSchema.safeParse({
      text: 'What is the status of CompIQ?',
      source: 'carplay',
    });
    expect(result.success).toBe(true);
  });

  test('accepts valid siri message', () => {
    const result = CarPlayMessageSchema.safeParse({
      text: 'Tell me about fleet health',
      source: 'siri',
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty text', () => {
    const result = CarPlayMessageSchema.safeParse({
      text: '',
      source: 'carplay',
    });
    expect(result.success).toBe(false);
  });

  test('rejects text over 2000 chars', () => {
    const result = CarPlayMessageSchema.safeParse({
      text: 'x'.repeat(2001),
      source: 'carplay',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid source', () => {
    const result = CarPlayMessageSchema.safeParse({
      text: 'Hello',
      source: 'discord',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing source', () => {
    const result = CarPlayMessageSchema.safeParse({ text: 'Hello' });
    expect(result.success).toBe(false);
  });

  test('rejects missing text', () => {
    const result = CarPlayMessageSchema.safeParse({ source: 'siri' });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// CarPlayAuthSchema
// =============================================================================

describe('CarPlayAuthSchema', () => {
  test('accepts valid pairing request', () => {
    const result = CarPlayAuthSchema.safeParse({
      deviceId: 'abc123hash',
      secret: 'my-secret',
    });
    expect(result.success).toBe(true);
  });

  test('rejects missing deviceId', () => {
    const result = CarPlayAuthSchema.safeParse({ secret: 'my-secret' });
    expect(result.success).toBe(false);
  });

  test('rejects missing secret', () => {
    const result = CarPlayAuthSchema.safeParse({ deviceId: 'abc123' });
    expect(result.success).toBe(false);
  });

  test('rejects empty deviceId', () => {
    const result = CarPlayAuthSchema.safeParse({
      deviceId: '',
      secret: 'my-secret',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty secret', () => {
    const result = CarPlayAuthSchema.safeParse({
      deviceId: 'abc123',
      secret: '',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// CarPlayRefreshSchema
// =============================================================================

describe('CarPlayRefreshSchema', () => {
  test('accepts valid refresh token', () => {
    const result = CarPlayRefreshSchema.safeParse({
      refreshToken: 'some-long-token-string',
    });
    expect(result.success).toBe(true);
  });

  test('rejects missing refreshToken', () => {
    const result = CarPlayRefreshSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('rejects empty refreshToken', () => {
    const result = CarPlayRefreshSchema.safeParse({ refreshToken: '' });
    expect(result.success).toBe(false);
  });
});
