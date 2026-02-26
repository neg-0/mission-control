/**
 * @module coordination
 * @description
 * Multi-agent coordination tools for the MC native runtime.
 * Provides task delegation, agent-to-agent messaging, and shared
 * knowledge (blackboard pattern) via the Prisma DB.
 *
 * These functions are used by the tool executor (tools.ts hits MC APIs)
 * and by the orchestrator to inject coordination context into agent wakes.
 */

import { prisma } from '@/lib/prisma';

// =============================================================================
// Types
// =============================================================================

export interface DelegationRequest {
  fromAgentId: string;
  targetAgentId: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  projectId?: string;
}

export interface AgentMessage {
  fromId: string;
  toId: string;
  subject?: string;
  body: string;
  channel?: string;
}

// =============================================================================
// Task Delegation
// =============================================================================

/**
 * Delegate a task from one agent to another.
 * Creates a Task in the DB and returns the task ID.
 */
export async function delegateTask(req: DelegationRequest): Promise<string> {
  const task = await prisma.task.create({
    data: {
      title: req.title,
      description: req.description || null,
      assigneeId: req.targetAgentId,
      assigneeType: 'agent',
      priority: req.priority || 'medium',
      projectId: req.projectId || null,
      status: 'todo',
      taskType: 'one_off',
    },
  });

  // Also log the delegation as a message for audit
  await prisma.messageLog.create({
    data: {
      fromId: req.fromAgentId,
      toId: req.targetAgentId,
      channel: 'delegation',
      subject: req.title,
      body: req.description || `Task delegated: ${req.title}`,
      status: 'sent',
      metadata: {
        taskId: task.id,
        priority: req.priority || 'medium',
        projectId: req.projectId,
      },
    },
  });

  return task.id;
}

// =============================================================================
// Agent-to-Agent Messaging
// =============================================================================

/**
 * Send a message between agents, persisted in the MessageLog.
 */
export async function sendAgentMessage(msg: AgentMessage): Promise<string> {
  const entry = await prisma.messageLog.create({
    data: {
      fromId: msg.fromId,
      toId: msg.toId,
      channel: msg.channel || 'agent_message',
      subject: msg.subject || null,
      body: msg.body,
      status: 'sent',
    },
  });

  return entry.id;
}

/**
 * Get recent messages for an agent (inbox).
 * Used to inject message context into heartbeat wakes.
 */
export async function getRecentMessages(
  agentId: string,
  limit: number = 10,
): Promise<Array<{
  fromId: string;
  subject: string | null;
  body: string;
  channel: string;
  sentAt: Date;
}>> {
  return prisma.messageLog.findMany({
    where: {
      toId: agentId,
      sentAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
      },
    },
    select: {
      fromId: true,
      subject: true,
      body: true,
      channel: true,
      sentAt: true,
    },
    orderBy: { sentAt: 'desc' },
    take: limit,
  });
}

// =============================================================================
// Pending Delegations
// =============================================================================

/**
 * Get pending tasks delegated TO a specific agent.
 * Used to inject delegation context into heartbeat wakes.
 */
export async function getPendingDelegations(
  agentId: string,
): Promise<Array<{
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  createdAt: Date;
}>> {
  return prisma.task.findMany({
    where: {
      assigneeId: agentId,
      assigneeType: 'agent',
      taskType: 'one_off',
      status: { in: ['todo', 'in_progress', 'blocked'] },
    },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      status: true,
      createdAt: true,
    },
    orderBy: [
      { priority: 'desc' },
      { createdAt: 'desc' },
    ],
    take: 20,
  });
}
