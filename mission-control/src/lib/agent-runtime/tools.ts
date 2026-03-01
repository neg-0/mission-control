/**
 * @module tools
 * @description
 * Tool executor for the MC native agent runtime.
 * Provides a lean set of tools CEO agents need: file I/O, bash execution,
 * web fetch, and MC-native operations (journal, escalation, delegation, messaging).
 *
 * Security: bash_exec uses a strict command allowlist. File operations
 * are scoped to the agent's workspace path.
 */

import { ToolDefinition } from './providers';

// =============================================================================
// Tool Result Type
// =============================================================================

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

// =============================================================================
// Tool Registry
// =============================================================================

export interface ToolImplementation {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  agentId: string;
  workspacePath: string;
  mcBaseUrl: string;
}

// =============================================================================
// Bash Exec Allowlist
// =============================================================================

const ALLOWED_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'echo', 'pwd', 'date',
  'mkdir', 'cp', 'mv', 'rm', 'touch', 'chmod',
  'git', 'gh',
  'npm', 'npx', 'node', 'tsx', 'tsc',
  'python3', 'python', 'pip', 'pip3',
  'curl', 'wget',
  'jq', 'sed', 'awk', 'sort', 'uniq', 'tr', 'cut', 'diff',
  'tar', 'gzip', 'gunzip', 'zip', 'unzip',
  'env', 'printenv', 'which', 'whoami',
  'docker', 'docker-compose',
  'railway',
  'prisma',
]);

function isCommandAllowed(command: string): boolean {
  // Extract the base command (first word, ignoring env vars and paths)
  const trimmed = command.trim();
  // Handle "cd /path && cmd", "FOO=bar cmd", etc.
  const parts = trimmed.split(/[;&|]/)[0].trim().split(/\s+/);
  let baseCmd = parts[0];

  // Skip env var assignments
  while (baseCmd && baseCmd.includes('=')) {
    parts.shift();
    baseCmd = parts[0];
  }

  if (!baseCmd) return false;

  // Strip path prefix (e.g., /usr/bin/git → git)
  const cmdName = baseCmd.split('/').pop() || '';
  return ALLOWED_COMMANDS.has(cmdName);
}

// =============================================================================
// Tool Implementations
// =============================================================================

import { exec } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, relative, resolve } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

function assertWithinWorkspace(filePath: string, workspacePath: string): void {
  const resolved = resolve(filePath);
  const workspace = resolve(workspacePath);
  if (!resolved.startsWith(workspace)) {
    throw new Error(`Path "${filePath}" is outside workspace "${workspacePath}"`);
  }
}

// --- file_read ---
const fileReadTool: ToolImplementation = {
  definition: {
    name: 'file_read',
    description: 'Read the contents of a file within the agent workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute path to the file' },
      },
      required: ['path'],
    },
  },
  async execute(args, ctx) {
    try {
      const filePath = resolve(ctx.workspacePath, args.path as string);
      assertWithinWorkspace(filePath, ctx.workspacePath);
      const content = await readFile(filePath, 'utf-8');
      // Truncate very large files
      const maxLen = 50000;
      const truncated = content.length > maxLen
        ? content.slice(0, maxLen) + `\n... (truncated, ${content.length} total chars)`
        : content;
      return { success: true, output: truncated };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
};

// --- file_write ---
const fileWriteTool: ToolImplementation = {
  definition: {
    name: 'file_write',
    description: 'Write content to a file within the agent workspace. Creates parent directories if needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute path to the file' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
  },
  async execute(args, ctx) {
    try {
      const filePath = resolve(ctx.workspacePath, args.path as string);
      assertWithinWorkspace(filePath, ctx.workspacePath);
      const dir = join(filePath, '..');
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(filePath, args.content as string, 'utf-8');
      return { success: true, output: `Written ${(args.content as string).length} chars to ${relative(ctx.workspacePath, filePath)}` };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
};

// --- bash_exec ---
const bashExecTool: ToolImplementation = {
  definition: {
    name: 'bash_exec',
    description: 'Execute a shell command. Only allowlisted commands are permitted (git, npm, node, python, curl, etc). Working directory is the agent workspace.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (relative to workspace). Default: workspace root.' },
      },
      required: ['command'],
    },
  },
  async execute(args, ctx) {
    const command = args.command as string;
    if (!isCommandAllowed(command)) {
      return {
        success: false,
        output: '',
        error: `Command not in allowlist. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`,
      };
    }

    const cwd = args.cwd
      ? resolve(ctx.workspacePath, args.cwd as string)
      : ctx.workspacePath;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: 60000, // 60s timeout
        maxBuffer: 1024 * 1024, // 1MB
        env: { ...process.env, HOME: process.env.HOME },
      });

      const output = (stdout + (stderr ? `\nSTDERR: ${stderr}` : '')).trim();
      // Truncate large output
      const maxLen = 20000;
      const truncated = output.length > maxLen
        ? output.slice(0, maxLen) + `\n... (truncated, ${output.length} total chars)`
        : output;
      return { success: true, output: truncated };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      const output = (execErr.stdout || '') + (execErr.stderr || '');
      return {
        success: false,
        output: output.slice(0, 5000),
        error: execErr.message || String(err),
      };
    }
  },
};

// --- web_fetch ---
const webFetchTool: ToolImplementation = {
  definition: {
    name: 'web_fetch',
    description: 'Make an HTTP request. Useful for calling APIs, checking URLs, etc.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE). Default: GET' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body (for POST/PUT)' },
      },
      required: ['url'],
    },
  },
  async execute(args) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const res = await fetch(args.url as string, {
        method: (args.method as string) || 'GET',
        headers: (args.headers as Record<string, string>) || {},
        body: args.body ? (args.body as string) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const text = await res.text();
      const maxLen = 20000;
      const truncated = text.length > maxLen
        ? text.slice(0, maxLen) + `\n... (truncated)`
        : text;

      return {
        success: res.ok,
        output: `Status: ${res.status}\n${truncated}`,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
};

// --- mc_journal ---
const mcJournalTool: ToolImplementation = {
  definition: {
    name: 'mc_journal',
    description: 'Write a journal entry to Mission Control. This persists your progress across sessions.',
    parameters: {
      type: 'object',
      properties: {
        did: { type: 'string', description: 'What was accomplished in this session' },
        next: { type: 'string', description: 'What to do next session' },
        status: { type: 'string', enum: ['healthy', 'blocked', 'idle', 'error'], description: 'Current agent status' },
        blockers: { type: 'string', description: 'What is blocking progress (if any)' },
      },
      required: ['did', 'status'],
    },
  },
  async execute(args, ctx) {
    try {
      const res = await fetch(`${ctx.mcBaseUrl}/api/journal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: ctx.agentId,
          did: args.did,
          next: args.next || null,
          status: args.status || 'healthy',
          blockers: args.blockers || null,
        }),
      });
      if (!res.ok) throw new Error(`MC API error: ${res.status}`);
      return { success: true, output: 'Journal entry saved.' };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
};

// --- mc_escalate ---
const mcEscalateTool: ToolImplementation = {
  definition: {
    name: 'mc_escalate',
    description: 'Escalate an issue to the human operator (Dustin). Use for budget decisions, security concerns, architecture choices, or production incidents.',
    parameters: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['warning', 'critical', 'blocker'], description: 'Severity level' },
        category: { type: 'string', description: 'Category: budget, security, architecture, production, merge' },
        title: { type: 'string', description: 'Short descriptive title' },
        description: { type: 'string', description: 'Detailed description with context' },
      },
      required: ['severity', 'category', 'title'],
    },
  },
  async execute(args, ctx) {
    try {
      const res = await fetch(`${ctx.mcBaseUrl}/api/escalations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAgentId: ctx.agentId,
          severity: args.severity,
          category: args.category,
          title: args.title,
          description: args.description || null,
        }),
      });
      if (!res.ok) throw new Error(`MC API error: ${res.status}`);
      return { success: true, output: `Escalation created: ${args.title}` };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
};

// --- mc_delegate ---
const mcDelegateTool: ToolImplementation = {
  definition: {
    name: 'mc_delegate',
    description: 'Delegate a task to another agent. The task will be assigned and the target agent will be woken on their next heartbeat.',
    parameters: {
      type: 'object',
      properties: {
        targetAgentId: { type: 'string', description: 'ID of the agent to delegate to (e.g., "captain", "sarge")' },
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Detailed task description and context' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Priority level' },
        projectId: { type: 'string', description: 'Project ID (optional)' },
      },
      required: ['targetAgentId', 'title'],
    },
  },
  async execute(args, ctx) {
    try {
      const res = await fetch(`${ctx.mcBaseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: args.title,
          description: args.description || null,
          assigneeId: args.targetAgentId,
          assigneeType: 'agent',
          priority: args.priority || 'medium',
          projectId: args.projectId || null,
          status: 'todo',
          taskType: 'one_off',
        }),
      });
      if (!res.ok) throw new Error(`MC API error: ${res.status}`);
      return {
        success: true,
        output: `Task "${args.title}" delegated to ${args.targetAgentId}. They will pick it up on their next heartbeat.`,
      };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
};

// --- mc_message ---
const mcMessageTool: ToolImplementation = {
  definition: {
    name: 'mc_message',
    description: 'Send a message to another agent or to the human operator. Messages are persisted in the audit log and delivered via Discord.',
    parameters: {
      type: 'object',
      properties: {
        toId: { type: 'string', description: 'Target: agent ID (e.g., "rocket") or "dustin" or "broadcast"' },
        subject: { type: 'string', description: 'Message subject line' },
        body: { type: 'string', description: 'Message body' },
      },
      required: ['toId', 'body'],
    },
  },
  async execute(args, ctx) {
    try {
      const res = await fetch(`${ctx.mcBaseUrl}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromId: ctx.agentId,
          toId: args.toId,
          channel: 'agent_message',
          subject: args.subject || null,
          body: args.body,
          status: 'sent',
        }),
      });
      if (!res.ok) throw new Error(`MC API error: ${res.status}`);
      return { success: true, output: `Message sent to ${args.toId}.` };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
};

// =============================================================================
// Tool Registry
// =============================================================================

export const ALL_TOOLS: ToolImplementation[] = [
  fileReadTool,
  fileWriteTool,
  bashExecTool,
  webFetchTool,
  mcJournalTool,
  mcEscalateTool,
  mcDelegateTool,
  mcMessageTool,
];

/** Get tool definitions for LLM (used in provider calls) */
export function getToolDefinitions(): ToolDefinition[] {
  return ALL_TOOLS.map((t) => t.definition);
}

/** Execute a tool by name */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = ALL_TOOLS.find((t) => t.definition.name === name);
  if (!tool) {
    return { success: false, output: '', error: `Unknown tool: ${name}` };
  }
  return tool.execute(args, context);
}
