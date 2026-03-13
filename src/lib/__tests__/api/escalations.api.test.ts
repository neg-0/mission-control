/**
 * API Integration Tests: /api/escalations
 *
 * Tests GET, POST, PATCH against a real test database.
 * Validates request/response shapes, Zod validation, cross-model writes,
 * and error handling.
 */
import { GET, POST, PATCH } from '@/app/api/escalations/route';
import { createTestRequest, parseResponse } from '../helpers/api-test-utils';
import { resetDatabase, disconnectTestDb, testPrisma } from '../helpers/test-db';
import { createTestEscalation } from '../helpers/factories';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

// ── GET /api/escalations ─────────────────────────────────────────────────

describe('GET /api/escalations', () => {
  it('returns empty array when no escalations exist', async () => {
    const req = createTestRequest('/api/escalations');
    const res = await GET(req);
    const { status, data } = await parseResponse<unknown[]>(res);

    expect(status).toBe(200);
    expect(data).toEqual([]);
  });

  it('returns all escalations ordered by createdAt desc', async () => {
    await createTestEscalation({ title: 'First', severity: 'warning' });
    await createTestEscalation({ title: 'Second', severity: 'critical' });

    const req = createTestRequest('/api/escalations');
    const res = await GET(req);
    const { status, data } = await parseResponse<Array<{ title: string }>>(res);

    expect(status).toBe(200);
    expect(data).toHaveLength(2);
    // Descending order: most recent first
    expect(data[0].title).toBe('Second');
    expect(data[1].title).toBe('First');
  });

  it('filters by status', async () => {
    await createTestEscalation({ title: 'Open', status: 'open' });
    await createTestEscalation({ title: 'Resolved', status: 'resolved' });

    const req = createTestRequest('/api/escalations?status=open');
    const res = await GET(req);
    const { status, data } = await parseResponse<Array<{ title: string }>>(res);

    expect(status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('Open');
  });

  it('filters by severity', async () => {
    await createTestEscalation({ title: 'Warning', severity: 'warning' });
    await createTestEscalation({ title: 'Blocker', severity: 'blocker' });

    const req = createTestRequest('/api/escalations?severity=blocker');
    const res = await GET(req);
    const { status, data } = await parseResponse<Array<{ title: string }>>(res);

    expect(status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('Blocker');
  });

  it('filters by fromAgentId', async () => {
    await createTestEscalation({ title: 'From Warden', fromAgentId: 'warden' });
    await createTestEscalation({ title: 'From Sarge', fromAgentId: 'sarge' });

    const req = createTestRequest('/api/escalations?fromAgentId=warden');
    const res = await GET(req);
    const { status, data } = await parseResponse<Array<{ title: string }>>(res);

    expect(status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('From Warden');
  });
});

// ── POST /api/escalations ────────────────────────────────────────────────

describe('POST /api/escalations', () => {
  it('creates an escalation and auto-logs a message', async () => {
    const req = createTestRequest('/api/escalations', {
      method: 'POST',
      body: {
        fromAgentId: 'warden',
        severity: 'critical',
        category: 'security',
        title: 'SSL cert expiring in 24h',
        description: 'The cert for chocks.ai expires tomorrow.',
      },
    });

    const res = await POST(req);
    const { status, data } = await parseResponse<{
      id: string;
      severity: string;
      category: string;
      title: string;
      status: string;
    }>(res);

    expect(status).toBe(201);
    expect(data.severity).toBe('critical');
    expect(data.category).toBe('security');
    expect(data.title).toBe('SSL cert expiring in 24h');
    expect(data.status).toBe('open');

    // Verify the auto-logged message in MessageLog
    const messages = await testPrisma.messageLog.findMany({
      where: { channel: 'escalation' },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].fromId).toBe('warden');
    expect(messages[0].toId).toBe('dustin');
    expect(messages[0].subject).toBe('[CRITICAL] SSL cert expiring in 24h');
    expect(messages[0].status).toBe('sent');
  });

  it('creates an escalation without optional description', async () => {
    const req = createTestRequest('/api/escalations', {
      method: 'POST',
      body: {
        fromAgentId: 'captain',
        severity: 'warning',
        category: 'budget',
        title: 'API costs approaching daily limit',
      },
    });

    const res = await POST(req);
    const { status, data } = await parseResponse<{ title: string; description: string | null }>(res);

    expect(status).toBe(201);
    expect(data.description).toBeNull();
  });

  it('rejects request missing required fields', async () => {
    const req = createTestRequest('/api/escalations', {
      method: 'POST',
      body: {
        fromAgentId: 'warden',
        severity: 'critical',
        // missing: category, title
      },
    });

    const res = await POST(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });

  it('rejects request with invalid severity', async () => {
    const req = createTestRequest('/api/escalations', {
      method: 'POST',
      body: {
        fromAgentId: 'warden',
        severity: 'mega-critical', // invalid
        category: 'security',
        title: 'Test',
      },
    });

    const res = await POST(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });
});

// ── PATCH /api/escalations ───────────────────────────────────────────────

describe('PATCH /api/escalations', () => {
  it('resolves an escalation and sets resolvedAt', async () => {
    const escalation = await createTestEscalation({
      severity: 'critical',
      category: 'production',
      title: 'Deploy failed',
    });

    const req = createTestRequest('/api/escalations', {
      method: 'PATCH',
      body: {
        id: escalation.id,
        status: 'resolved',
        resolvedBy: 'dustin',
        resolution: 'Redeployed successfully after fixing build error.',
      },
    });

    const res = await PATCH(req);
    const { status, data } = await parseResponse<{
      id: string;
      status: string;
      resolvedBy: string;
      resolvedAt: string;
    }>(res);

    expect(status).toBe(200);
    expect(data.status).toBe('resolved');
    expect(data.resolvedBy).toBe('dustin');
    expect(data.resolvedAt).toBeTruthy();
  });

  it('dismisses an escalation and sets resolvedAt', async () => {
    const escalation = await createTestEscalation({ title: 'False alarm' });

    const req = createTestRequest('/api/escalations', {
      method: 'PATCH',
      body: {
        id: escalation.id,
        status: 'dismissed',
      },
    });

    const res = await PATCH(req);
    const { status, data } = await parseResponse<{ status: string; resolvedAt: string }>(res);

    expect(status).toBe(200);
    expect(data.status).toBe('dismissed');
    expect(data.resolvedAt).toBeTruthy();
  });

  it('acknowledges an escalation without setting resolvedAt', async () => {
    const escalation = await createTestEscalation({ title: 'Investigating' });

    const req = createTestRequest('/api/escalations', {
      method: 'PATCH',
      body: {
        id: escalation.id,
        status: 'ack',
      },
    });

    const res = await PATCH(req);
    const { status, data } = await parseResponse<{ status: string; resolvedAt: string | null }>(res);

    expect(status).toBe(200);
    expect(data.status).toBe('ack');
    expect(data.resolvedAt).toBeNull();
  });

  it('rejects PATCH with invalid UUID', async () => {
    const req = createTestRequest('/api/escalations', {
      method: 'PATCH',
      body: {
        id: 'not-a-uuid',
        status: 'resolved',
      },
    });

    const res = await PATCH(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });
});
