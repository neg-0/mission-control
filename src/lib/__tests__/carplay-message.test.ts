/**
 * @module carplay-message.test
 * @description
 * Tests for the two-output message parser.
 */

import { parseRocketResponse } from '../carplay-message';

describe('parseRocketResponse', () => {
  test('parses [CARPLAY] and [FULL] sections correctly', () => {
    const response = `[CARPLAY]
- Status: All systems green
- Next: Deploy CompIQ v2.1
- Blockers: None

[FULL]
All 4 agents are healthy. CompIQ is ready for v2.1 deployment.
Remaining tasks: update docs, run smoke tests.
No blockers. MRR is $105/mo.`;

    const result = parseRocketResponse(response);
    expect(result.carplay).toContain('All systems green');
    expect(result.carplay).toContain('Blockers: None');
    expect(result.full).toContain('CompIQ is ready for v2.1');
    expect(result.full).toContain('$105/mo');
  });

  test('handles response with only [CARPLAY] marker', () => {
    const response = `[CARPLAY]
- Status: Fleet healthy
- Next: Push to prod`;

    const result = parseRocketResponse(response);
    expect(result.carplay).toContain('Fleet healthy');
    expect(result.full).toBe(response);
  });

  test('falls back to truncation when no markers present', () => {
    const response = 'Just a plain text response from Rocket with no markers.';
    const result = parseRocketResponse(response);
    expect(result.carplay).toBe(response);
    expect(result.full).toBe(response);
  });

  test('truncates long responses without markers to 480 chars', () => {
    const longResponse = 'A'.repeat(600);
    const result = parseRocketResponse(longResponse);
    expect(result.carplay.length).toBeLessThanOrEqual(480);
    expect(result.carplay.endsWith('...')).toBe(true);
    expect(result.full).toBe(longResponse);
  });

  test('handles empty response', () => {
    const result = parseRocketResponse('');
    expect(result.carplay).toBe('');
    expect(result.full).toBe('');
  });

  test('handles response with markers but no content between them', () => {
    const response = '[CARPLAY]\n[FULL]\nSome full content here.';
    const result = parseRocketResponse(response);
    expect(result.carplay).toBe('');
    expect(result.full).toBe('Some full content here.');
  });

  test('preserves multiline content in both sections', () => {
    const response = `[CARPLAY]
Line 1
Line 2
Line 3

[FULL]
Full line 1
Full line 2`;

    const result = parseRocketResponse(response);
    expect(result.carplay).toContain('Line 1');
    expect(result.carplay).toContain('Line 3');
    expect(result.full).toContain('Full line 1');
    expect(result.full).toContain('Full line 2');
  });
});
