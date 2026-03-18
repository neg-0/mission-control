/**
 * @module api/messages/bus
 * @description
 * Message bus for routing messages between pods in the Mission Control fleet.
 *
 * The message bus extends the MessageLog system to provide:
 * - Routed message delivery (unicast, broadcast)
 * - Channel-specific handling (task, escalation, delegation, status)
 * - Message status tracking (pending, delivered, ack, failed)
 * - Queue management per agent
 *
 * **Endpoints:**
 * - POST /api/messages/bus — Send a routed message
 * - GET /api/messages/bus — Retrieve agent's message queue
 * - PATCH /api/messages/bus — Update message status
 *
 * @see {@link module:api/messages} for the base MessageLog system
 */

import { prisma } from '@/lib/prisma';
import { formatZodError } from '@/lib/schemas';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// =============================================================================
// Validation Schemas
// =============================================================================

/**
 * Schema for sending a routed message via the bus.
 *
 * @example
 * ```json
 * {
 *   "from": "sarge",
 *   "to": "rocket",
 *   "channel": "task",
 *   "subject": "Deploy approval needed",
 *   "body": "Ready to deploy Chocks v1.2 to Railway",
 *   "priority": "high"
 * }
 * ```
 */
const SendMessageSchema = z.object({
  /** Sender agent ID */
  from: z.string().min(1, 'from is required'),
  /** Recipient agent ID, "broadcast", or group name */
  to: z.string().min(1, 'to is required'),
  /** Message channel */
  channel: z.enum(['task', 'escalation', 'delegation', 'status', 'message']),
  /** Subject line */
  subject: z.string().min(1, 'subject is required'),
  /** Message body */
  body: z.string().min(1, 'body is required'),
  /** Priority level */
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  /** Message to reply to (optional) */
  replyTo: z.string().uuid().optional(),
});

type _SendMessageInput = z.infer<typeof SendMessageSchema>;

/**
 * Schema for querying the message queue.
 */
const _QueryQueueSchema = z.object({
  agentId: z.string().min(1, 'agentId is required'),
  channel: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

type _QueryQueueInput = z.infer<typeof _QueryQueueSchema>;

/**
 * Schema for updating message status.
 */
const UpdateMessageStatusSchema = z.object({
  messageId: z.string().uuid('messageId must be a valid UUID'),
  status: z.enum(['ack', 'delivered', 'failed']),
});

type _UpdateMessageStatusInput = z.infer<typeof UpdateMessageStatusSchema>;

// =============================================================================
// POST /api/messages/bus — Send a routed message
// =============================================================================

/**
 * Sends a message through the bus, with channel-specific side effects.
 *
 * Channel handling:
 * - **escalation** — Also creates Escalation record
 * - **task** — Also creates Task record assigned to recipient
 * - **delegation** — Logs with metadata { delegationType: true }
 * - **status** — Regular message log
 * - **message** — Regular message log
 *
 * If `to` is "broadcast", creates one MessageLog per active agent (excluding sender).
 */
async function handlePOST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = SendMessageSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const msg = result.data;

    // Verify sender exists
    const sender = await prisma.agent.findUnique({
      where: { id: msg.from },
    });
    if (!sender) {
      return NextResponse.json(
        { error: `Sender agent not found: ${msg.from}` },
        { status: 404 }
      );
    }

    // Determine recipients
    let recipients: string[] = [];
    if (msg.to === 'broadcast') {
      // Broadcast to all active agents except sender
      const agents = await prisma.agent.findMany({
        where: {
          status: 'active',
          id: { not: msg.from },
        },
        select: { id: true },
      });
      recipients = agents.map((a) => a.id);
    } else {
      // Unicast
      recipients = [msg.to];
    }

    // Create messages for each recipient
    const createdMessages = [];
    const metadata = {
      priority: msg.priority,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    } as Record<string, string>;

    for (const recipient of recipients) {
      // Verify recipient exists
      const recipientAgent = await prisma.agent.findUnique({
        where: { id: recipient },
      });
      if (!recipientAgent) {
        console.warn(`[MessageBus] Recipient agent not found: ${recipient}`);
        continue;
      }

      // Create MessageLog entry
      const messageLog = await prisma.messageLog.create({
        data: {
          fromId: msg.from,
          toId: recipient,
          channel: msg.channel,
          subject: msg.subject,
          body: msg.body,
          status: 'sent',
          metadata,
        },
      });

      // Channel-specific side effects
      if (msg.channel === 'escalation') {
        // Create Escalation record
        await prisma.escalation.create({
          data: {
            fromAgentId: msg.from,
            severity: (metadata.priority as string) === 'critical' ? 'critical' : 'warning',
            category: 'bus_escalation',
            title: msg.subject,
            description: msg.body,
          },
        });
      } else if (msg.channel === 'task') {
        // Create Task record assigned to recipient
        await prisma.task.create({
          data: {
            title: msg.subject,
            description: msg.body,
            status: 'todo',
            priority:
              (metadata.priority as string) === 'critical' ? 'critical' : 'high',
            assigneeId: recipient,
            assigneeType: 'agent',
          },
        });
      } else if (msg.channel === 'delegation') {
        // Log delegation flag in metadata
        await prisma.messageLog.update({
          where: { id: messageLog.id },
          data: {
            metadata: {
              ...metadata,
              delegationType: true,
            },
          },
        });
      }

      createdMessages.push(messageLog);
    }

    return NextResponse.json(
      {
        messageCount: createdMessages.length,
        messages: createdMessages,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error('[MessageBus POST]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// =============================================================================
// GET /api/messages/bus — Get message queue for an agent
// =============================================================================

/**
 * Retrieves the message queue for an agent.
 *
 * Query params:
 * - `agentId` (required) — Agent to query
 * - `channel` (optional) — Filter by channel
 * - `status` (optional) — Filter by status (default: pending)
 * - `limit` (optional) — Max results (default: 20, max: 100)
 */
async function handleGET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const channel = searchParams.get('channel');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    if (!agentId) {
      return NextResponse.json(
        { error: 'agentId query param is required' },
        { status: 400 }
      );
    }

    // Verify agent exists
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!agent) {
      return NextResponse.json(
        { error: `Agent not found: ${agentId}` },
        { status: 404 }
      );
    }

    // Build where clause
    const where: Prisma.MessageLogWhereInput = {
      toId: agentId,
      status: status || 'sent', // Default to "sent" = pending delivery
    };

    if (channel) {
      where.channel = channel;
    }

    // Query messages
    const messages = await prisma.messageLog.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      take: Math.min(limit, 100),
    });

    const total = await prisma.messageLog.count({ where });

    return NextResponse.json({
      agentId,
      messages,
      total,
      limit,
    });
  } catch (e) {
    console.error('[MessageBus GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// =============================================================================
// PATCH /api/messages/bus — Acknowledge/update message status
// =============================================================================

/**
 * Updates the status of a message (ack, delivered, failed).
 *
 * @param request - JSON body with { messageId, status }
 */
async function handlePATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const result = UpdateMessageStatusSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(formatZodError(result.error), { status: 400 });
    }

    const { messageId, status } = result.data;

    // Update message
    const updated = await prisma.messageLog.update({
      where: { id: messageId },
      data: { status },
    });

    return NextResponse.json(updated);
  } catch (e) {
    console.error('[MessageBus PATCH]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// =============================================================================
// Router
// =============================================================================

export async function GET(request: NextRequest) {
  return handleGET(request);
}

export async function POST(request: NextRequest) {
  return handlePOST(request);
}

export async function PATCH(request: NextRequest) {
  return handlePATCH(request);
}
