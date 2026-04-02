/**
 * @module build-heartbeat-context
 * @description
 * Builds a context-rich wake message for agent heartbeats.
 * Queries MC's database (journal, tasks, goals, escalations) per agent
 * and assembles a structured briefing that replaces the generic
 * "⏰ Scheduled: Heartbeat" payload.
 *
 * This gives agents synthetic memory across isolated sessions and
 * enables informed decision-making without main-session context.
 */

import { prisma } from '@/lib/prisma';

interface ContextOptions {
  journalEntries?: number;
  mdInjections?: string[];
}

/**
 * Resolve SOUL.md content for a given agent.
 * Returns DB content if available, otherwise returns null (caller falls back to filesystem fetch).
 */
async function resolveSoulFromDb(agentId: string): Promise<string | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { soulContent: true },
  });
  return agent?.soulContent ?? null;
}

/**
 * Build a context-rich heartbeat message for a specific agent.
 */
export async function buildHeartbeatContext(
  agentId: string,
  scheduleName: string,
  options?: ContextOptions
): Promise<string> {
  // Load orchestrator config for defaults
  const config = await prisma.orchestratorConfig.findUnique({
    where: { id: 'singleton' },
  });

  const journalLimit = options?.journalEntries ?? config?.journalEntries ?? 5;
  const mdPaths: string[] = options?.mdInjections
    ?? (Array.isArray(config?.mdInjections) ? config.mdInjections as string[] : []);

  // For SOUL.md injections, prefer the DB column (issue #30)
  const soulFromDb = mdPaths.some((p) => p.endsWith('SOUL.md'))
    ? await resolveSoulFromDb(agentId)
    : null;

  // Parallel queries for all context data
  const [journal, oneOffTasks, standingTasks, goals, escalations, mdContents] = await Promise.all([
    // Recent journal entries (synthetic memory)
    prisma.agentJournal.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: journalLimit,
    }),

    // Pending one-off tasks assigned to this agent
    prisma.task.findMany({
      where: {
        assigneeId: agentId,
        taskType: 'one_off',
        status: { in: ['todo', 'in_progress', 'blocked', 'review'] },
      },
      include: {
        goal: { select: { title: true } },
        project: { select: { name: true } },
      },
      orderBy: [
        { priority: 'desc' },
        { updatedAt: 'desc' },
      ],
      take: 10,
    }),

    // Standing tasks (shown only when no one-offs)
    prisma.task.findMany({
      where: {
        assigneeId: agentId,
        taskType: 'standing',
        status: { in: ['todo', 'in_progress'] },
      },
      include: {
        project: { select: { name: true } },
      },
      take: 5,
    }),

    // Active goals owned by this agent
    prisma.goal.findMany({
      where: {
        ownerAgentId: agentId,
        status: { in: ['queued', 'in_progress'] },
      },
      include: {
        project: { select: { name: true } },
      },
      take: 5,
    }),

    // Open escalations from this agent
    prisma.escalation.findMany({
      where: {
        fromAgentId: agentId,
        status: 'open',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),

    // Read markdown file injections (SOUL.md prefers DB content when available)
    loadMarkdownInjections(mdPaths, soulFromDb),
  ]);

  // Build the message sections
  const sections: string[] = [];

  // Header
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  sections.push(`⏰ MC Heartbeat: ${scheduleName} | Agent: ${agentId}`);
  sections.push(`🕐 ${timeStr}`);

  // Journal (synthetic memory)
  if (journal.length > 0) {
    const entries = journal.map((j) => {
      const time = j.createdAt.toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const parts = [`[${time}] DID: ${j.did}`];
      if (j.next) parts.push(`NEXT: ${j.next}`);
      parts.push(`STATUS: ${j.status}`);
      if (j.blockers) parts.push(`BLOCKED: ${j.blockers}`);
      return `  ${parts.join(' | ')}`;
    });
    sections.push(`\n📓 RECENT ACTIVITY:\n${entries.join('\n')}`);
  } else {
    sections.push(`\n📓 RECENT ACTIVITY: No previous activity recorded.`);
  }

  // Tasks
  if (oneOffTasks.length > 0) {
    const taskLines = oneOffTasks.map((t) => {
      const pri = t.priority.toUpperCase();
      const goalInfo = t.goal ? `, goal: "${t.goal.title}"` : '';
      const projInfo = t.project ? `, project: ${t.project.name}` : '';
      return `  - [${pri}] ${t.title} (${t.status}${goalInfo}${projInfo})`;
    });
    sections.push(`\n📋 YOUR TASKS:\n${taskLines.join('\n')}`);
  } else if (standingTasks.length > 0) {
    sections.push(`\n📋 YOUR TASKS: No pending one-off tasks.`);
    const standingLines = standingTasks.map((t) => {
      const projInfo = t.project ? `, project: ${t.project.name}` : '';
      return `  - [LOW] ${t.title} (standing${projInfo})`;
    });
    sections.push(`\n🔄 STANDING ORDERS (pick one if worthwhile):\n${standingLines.join('\n')}`);
  } else {
    sections.push(`\n📋 YOUR TASKS: No pending tasks.`);
  }

  // Goals
  if (goals.length > 0) {
    const goalLines = goals.map((g) => {
      const projInfo = g.project ? `, project: ${g.project.name}` : '';
      return `  - ${g.title} (${g.progress}%${projInfo})`;
    });
    sections.push(`\n🎯 ACTIVE GOALS:\n${goalLines.join('\n')}`);
  }

  // Escalations
  if (escalations.length > 0) {
    const escLines = escalations.map((e) => {
      const age = getRelativeTime(e.createdAt);
      return `  - [${e.severity.toUpperCase()}] ${e.title} (${age})`;
    });
    sections.push(`\n🔥 OPEN ESCALATIONS:\n${escLines.join('\n')}`);
  } else {
    sections.push(`\n🔥 ESCALATIONS: None`);
  }

  // Markdown injections
  if (mdContents.length > 0) {
    for (const md of mdContents) {
      sections.push(`\n📎 INJECTED: ${md.path}\n${md.content}`);
    }
  }

  // Instructions
  sections.push(`
INSTRUCTIONS:
1. Read your HEARTBEAT.md and execute your checklist.
2. Log your work: POST ${process.env.NEXT_PUBLIC_MC_URL || 'http://localhost:3000'}/api/journal
   Body: { "agentId": "${agentId}", "did": "...", "next": "...", "status": "healthy|blocked|idle" }
3. If nothing needs attention, reply: HEARTBEAT_OK`);

  return sections.join('\n');
}

/**
 * Estimate token count for a message (~4 chars per token for English text).
 * This is a rough approximation — actual tokenization depends on the model.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Load contents of markdown files for injection.
 * For SOUL.md paths, prefers soulFromDb when provided (issue #30).
 */
async function loadMarkdownInjections(
  paths: string[],
  soulFromDb: string | null = null,
): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = [];
  if (paths.length === 0) return results;

  const baseUrl = process.env.NEXT_PUBLIC_MC_URL || 'http://localhost:3000';

  for (const p of paths) {
    // Prefer DB content for SOUL.md
    if (p.endsWith('SOUL.md') && soulFromDb) {
      const truncated = soulFromDb.length > 2000
        ? soulFromDb.slice(0, 2000) + '\n... (truncated)'
        : soulFromDb;
      results.push({ path: p, content: truncated });
      continue;
    }

    try {
      const res = await fetch(`${baseUrl}/api/files/read?path=${encodeURIComponent(p)}`);
      if (!res.ok) {
        results.push({ path: p, content: `(file not found: ${p})` });
        continue;
      }
      const data = await res.json();
      const content: string = data.content || '';
      // Truncate to prevent blowing up the context
      const truncated = content.length > 2000
        ? content.slice(0, 2000) + '\n... (truncated)'
        : content;
      results.push({ path: p, content: truncated });
    } catch {
      results.push({ path: p, content: `(file not found: ${p})` });
    }
  }
  return results;
}

/**
 * Get a relative time string like "2h ago", "5m ago"
 */
function getRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
