/**
 * @module agent-runtime
 * @description
 * Barrel export for the MC native agent runtime.
 */

export { runAgentLoop, type AgentConfig, type AgentRunResult } from './agent-loop';
export {
  delegateTask, getPendingDelegations, getRecentMessages, sendAgentMessage, type AgentMessage, type DelegationRequest
} from './coordination';
export {
  buildReflectionPrompt, extractPreCompactionKnowledge, getKnowledgeContext, searchKnowledge, writeKnowledge, type KnowledgeSearchOptions, type KnowledgeWrite
} from './memory';
export {
  buildProviderConfig, callLLM, type ChatMessage, type LLMResponse,
  type ProviderConfig, type ToolCall, type ToolDefinition
} from './providers';
export {
  estimateTokenCount, loadSession, replaceSession, saveMessage,
  saveMessages
} from './session-store';
export { buildSystemPrompt } from './system-prompt';
export { executeTool, getToolDefinitions, type ToolContext, type ToolResult } from './tools';

