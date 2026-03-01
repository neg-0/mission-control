/**
 * @module agent-loop
 * @description
 * Core agent execution loop for the MC native runtime.
 * Sends messages to an LLM, executes tool calls, and loops until
 * the agent produces a final text response or hits max iterations.
 *
 * This is the replacement for OpenClaw's pi-embedded-runner.
 */

import {
  buildProviderConfig,
  callLLM,
  type ChatMessage,
  type LLMResponse,
  type ProviderConfig,
} from './providers';
// Node.js-dependent modules loaded dynamically to avoid webpack bundling
// import session-store, system-prompt, tools at runtime inside runAgentLoop

// =============================================================================
// Types
// =============================================================================

export interface AgentConfig {
  agentId: string;
  workspacePath: string;
  providerPrimary: string;
  modelPrimary: string;
  providerFallback?: string;
  modelFallback?: string;
  maxIterations?: number;
  maxTokens?: number;
  temperature?: number;
}

export interface AgentRunResult {
  ok: boolean;
  response: string | null;
  iterations: number;
  toolCalls: number;
  tokensSent: number;
  tokensRecv: number;
  provider: string;
  model: string;
  error?: string;
}

// =============================================================================
// Agent Loop
// =============================================================================

/**
 * Run a single agent session.
 * This is the core loop: build prompt → call LLM → execute tools → repeat.
 *
 * @param config - Agent configuration (from DB)
 * @param contextMessage - The wake/heartbeat message that triggered this run
 * @param sessionId - UUID for this session (for JSONL persistence)
 */
export async function runAgentLoop(
  config: AgentConfig,
  contextMessage: string,
  sessionId: string,
): Promise<AgentRunResult> {
  // Dynamic imports: these modules use Node.js APIs (fs, path, child_process)
  // and must not be statically analyzed by Next.js webpack
  const { buildSystemPrompt } = await import('./system-prompt');
  const { saveMessage, estimateTokenCount } = await import('./session-store');
  const { executeTool, getToolDefinitions } = await import('./tools');

  const maxIterations = config.maxIterations || 25;
  const mcBaseUrl = process.env.NEXT_PUBLIC_MC_URL || 'http://localhost:3000';

  // Build provider configs
  const primary = buildProviderConfig(config.providerPrimary, config.modelPrimary, {
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  });

  const fallback = config.providerFallback && config.modelFallback
    ? buildProviderConfig(config.providerFallback, config.modelFallback, {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    })
    : undefined;

  // Build system prompt from workspace files
  const systemPrompt = await buildSystemPrompt(config.workspacePath, contextMessage);

  // Initialize conversation
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: contextMessage },
  ];

  // Save initial messages
  await saveMessage(config.workspacePath, sessionId, messages[0]);
  await saveMessage(config.workspacePath, sessionId, messages[1]);

  // Tool context for tool execution
  const toolContext = {
    agentId: config.agentId,
    workspacePath: config.workspacePath,
    mcBaseUrl,
  };

  const toolDefs = getToolDefinitions();

  // Tracking
  let totalIterations = 0;
  let totalToolCalls = 0;
  let totalTokensSent = 0;
  let totalTokensRecv = 0;
  let lastProvider: string = primary.provider;
  let lastModel: string = primary.model;

  // === THE LOOP ===
  for (let i = 0; i < maxIterations; i++) {
    totalIterations++;

    // Check context size — compact if over threshold
    const tokenEstimate = estimateTokenCount(messages);
    if (tokenEstimate > 80000) {
      console.log(`[AgentRuntime] Context at ~${tokenEstimate} tokens, compacting...`);
      await compactMessages(messages, primary, fallback);
    }

    // Call LLM
    let response: LLMResponse;
    try {
      response = await callLLM(messages, toolDefs, primary, fallback);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[AgentRuntime] LLM call failed: ${errorMsg}`);
      return {
        ok: false,
        response: null,
        iterations: totalIterations,
        toolCalls: totalToolCalls,
        tokensSent: totalTokensSent,
        tokensRecv: totalTokensRecv,
        provider: lastProvider,
        model: lastModel,
        error: errorMsg,
      };
    }

    lastProvider = response.provider;
    lastModel = response.model;
    if (response.usage) {
      totalTokensSent += response.usage.promptTokens;
      totalTokensRecv += response.usage.completionTokens;
    }

    // Build assistant message
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    };
    messages.push(assistantMsg);
    await saveMessage(config.workspacePath, sessionId, assistantMsg);

    // If no tool calls — agent is done
    if (response.toolCalls.length === 0) {
      return {
        ok: true,
        response: response.content,
        iterations: totalIterations,
        toolCalls: totalToolCalls,
        tokensSent: totalTokensSent,
        tokensRecv: totalTokensRecv,
        provider: lastProvider,
        model: lastModel,
      };
    }

    // Execute tool calls
    for (const tc of response.toolCalls) {
      totalToolCalls++;
      console.log(`[AgentRuntime] Tool call: ${tc.name}`);

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      const result = await executeTool(tc.name, args, toolContext);

      const toolResultMsg: ChatMessage = {
        role: 'tool',
        content: result.success
          ? result.output
          : `ERROR: ${result.error}\n${result.output}`,
        toolCallId: tc.id,
        name: tc.name,
      };
      messages.push(toolResultMsg);
      await saveMessage(config.workspacePath, sessionId, toolResultMsg);
    }
  }

  // Max iterations reached
  return {
    ok: true,
    response: `Agent completed after reaching max iterations (${maxIterations}).`,
    iterations: totalIterations,
    toolCalls: totalToolCalls,
    tokensSent: totalTokensSent,
    tokensRecv: totalTokensRecv,
    provider: lastProvider,
    model: lastModel,
  };
}

// =============================================================================
// Context Compaction
// =============================================================================

/**
 * Compact messages by summarizing the oldest 50% of conversation turns.
 * Keeps the system prompt and the most recent turns intact.
 */
async function compactMessages(
  messages: ChatMessage[],
  primary: ProviderConfig,
  fallback?: ProviderConfig,
): Promise<void> {
  if (messages.length < 6) return; // Not enough to compact

  // Save the system prompt
  const systemMsg = messages[0];

  // Keep last 30% of messages (minimum 4)
  const keepFromEnd = Math.max(4, Math.floor(messages.length * 0.3));
  const toSummarize = messages.slice(1, messages.length - keepFromEnd);

  if (toSummarize.length < 4) return; // Not enough to justify compaction

  // Build summary request
  const summaryPrompt: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are a conversation summarizer. Summarize the following conversation turns into a brief factual summary. Preserve key decisions, tool results, facts learned, and action items. Be concise but complete.',
    },
    {
      role: 'user',
      content: toSummarize
        .map((m) => `[${m.role}${m.name ? `:${m.name}` : ''}] ${m.content || '(tool calls)'}`)
        .join('\n'),
    },
  ];

  try {
    const summaryResponse = await callLLM(summaryPrompt, [], primary, fallback);
    const summary = summaryResponse.content || 'Previous conversation context (compacted).';

    // Rebuild: system prompt + summary + recent messages
    const recentMessages = messages.slice(messages.length - keepFromEnd);

    messages.length = 0; // Clear in-place
    messages.push(systemMsg);
    messages.push({
      role: 'user',
      content: `[CONTEXT SUMMARY - Previous ${toSummarize.length} messages compacted]\n${summary}`,
    });
    messages.push(...recentMessages);

    console.log(`[AgentRuntime] Compacted ${toSummarize.length} messages into summary. ${messages.length} messages remain.`);
  } catch (err) {
    console.error('[AgentRuntime] Compaction failed, continuing with full context:', err);
  }
}
