/**
 * @module agent-loop.test
 * @description
 * Unit tests for the core agent execution loop.
 * Mocks the LLM provider and tool executor to test loop behavior:
 * text response termination, tool execution cycles, max iterations, and errors.
 */

import { runAgentLoop, type AgentConfig } from '../agent-runtime/agent-loop';
import * as providers from '../agent-runtime/providers';
import * as sessionStore from '../agent-runtime/session-store';
import * as systemPrompt from '../agent-runtime/system-prompt';
import * as tools from '../agent-runtime/tools';

// Mock all dependencies
jest.mock('../agent-runtime/providers');
jest.mock('../agent-runtime/tools');
jest.mock('../agent-runtime/system-prompt');
jest.mock('../agent-runtime/session-store');

const mockCallLLM = providers.callLLM as jest.MockedFunction<typeof providers.callLLM>;
const mockBuildProviderConfig = providers.buildProviderConfig as jest.MockedFunction<typeof providers.buildProviderConfig>;
const mockExecuteTool = tools.executeTool as jest.MockedFunction<typeof tools.executeTool>;
const mockGetToolDefs = tools.getToolDefinitions as jest.MockedFunction<typeof tools.getToolDefinitions>;
const mockBuildSystemPrompt = systemPrompt.buildSystemPrompt as jest.MockedFunction<typeof systemPrompt.buildSystemPrompt>;
const mockSaveMessage = sessionStore.saveMessage as jest.MockedFunction<typeof sessionStore.saveMessage>;
const mockEstimateTokens = sessionStore.estimateTokenCount as jest.MockedFunction<typeof sessionStore.estimateTokenCount>;

const agentConfig: AgentConfig = {
  agentId: 'test-agent',
  workspacePath: '/home/neg0/.openclaw/workspace-test',
  providerPrimary: 'gemini',
  modelPrimary: 'gemini-3-flash',
  maxIterations: 5,
};

beforeEach(() => {
  jest.clearAllMocks();

  // Default mock behaviors
  mockBuildProviderConfig.mockReturnValue({
    provider: 'gemini',
    model: 'gemini-3-flash',
    maxTokens: 4096,
    temperature: 0.7,
  });

  mockBuildSystemPrompt.mockResolvedValue('You are a test agent.');
  mockSaveMessage.mockResolvedValue(undefined);
  mockEstimateTokens.mockReturnValue(1000); // Always under compaction threshold
  mockGetToolDefs.mockReturnValue([
    { name: 'file_read', description: 'Read file', parameters: { type: 'object', properties: {} } },
  ]);
});

// =============================================================================
// Simple text response
// =============================================================================

describe('text response termination', () => {
  it('completes on first text response', async () => {
    mockCallLLM.mockResolvedValueOnce({
      content: 'All done!',
      toolCalls: [],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });

    const result = await runAgentLoop(agentConfig, 'Hello agent', 'sess-001');

    expect(result.ok).toBe(true);
    expect(result.response).toBe('All done!');
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(result.provider).toBe('gemini');
    expect(result.tokensSent).toBe(100);
    expect(result.tokensRecv).toBe(20);
  });

  it('saves system, user, and assistant messages', async () => {
    mockCallLLM.mockResolvedValueOnce({
      content: 'Done',
      toolCalls: [],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
    });

    await runAgentLoop(agentConfig, 'Wake up', 'sess-002');

    // System + user + assistant = 3 messages saved
    expect(mockSaveMessage).toHaveBeenCalledTimes(3);
    expect(mockSaveMessage.mock.calls[0][2].role).toBe('system');
    expect(mockSaveMessage.mock.calls[1][2].role).toBe('user');
    expect(mockSaveMessage.mock.calls[2][2].role).toBe('assistant');
  });
});

// =============================================================================
// Tool execution loop
// =============================================================================

describe('tool execution', () => {
  it('executes tool call and continues to next LLM call', async () => {
    // First LLM call: returns tool call
    mockCallLLM.mockResolvedValueOnce({
      content: null,
      toolCalls: [
        { id: 'tc-1', name: 'file_read', arguments: '{"path":"README.md"}' },
      ],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
    });

    // Tool execution
    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      output: '# Hello\nThis is README.',
    });

    // Second LLM call: returns text (agent done)
    mockCallLLM.mockResolvedValueOnce({
      content: 'I read the README. It says Hello.',
      toolCalls: [],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
    });

    const result = await runAgentLoop(agentConfig, 'Read the readme', 'sess-003');

    expect(result.ok).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toBe(1);
    expect(result.response).toContain('README');

    // Verify tool was called with correct args
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'file_read',
      { path: 'README.md' },
      expect.objectContaining({ agentId: 'test-agent' }),
    );
  });

  it('handles multiple tool calls in one response', async () => {
    mockCallLLM.mockResolvedValueOnce({
      content: null,
      toolCalls: [
        { id: 'tc-1', name: 'file_read', arguments: '{"path":"a.md"}' },
        { id: 'tc-2', name: 'file_read', arguments: '{"path":"b.md"}' },
      ],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
    });

    mockExecuteTool.mockResolvedValue({
      success: true,
      output: 'content',
    });

    mockCallLLM.mockResolvedValueOnce({
      content: 'Read both files.',
      toolCalls: [],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
    });

    const result = await runAgentLoop(agentConfig, 'Read files', 'sess-004');

    expect(result.ok).toBe(true);
    expect(result.toolCalls).toBe(2);
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
  });

  it('handles tool execution failure gracefully', async () => {
    mockCallLLM.mockResolvedValueOnce({
      content: null,
      toolCalls: [
        { id: 'tc-1', name: 'file_read', arguments: '{"path":"/etc/passwd"}' },
      ],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
    });

    mockExecuteTool.mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'Path outside workspace',
    });

    // Agent responds to the error
    mockCallLLM.mockResolvedValueOnce({
      content: 'I cannot access that file.',
      toolCalls: [],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
    });

    const result = await runAgentLoop(agentConfig, 'Read passwd', 'sess-005');

    expect(result.ok).toBe(true);
    expect(result.response).toContain('cannot access');
  });
});

// =============================================================================
// Max iterations
// =============================================================================

describe('max iterations guard', () => {
  it('stops after maxIterations', async () => {
    // Every LLM call returns a tool call (infinite loop)
    mockCallLLM.mockResolvedValue({
      content: null,
      toolCalls: [
        { id: 'tc-loop', name: 'file_read', arguments: '{}' },
      ],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
    });

    mockExecuteTool.mockResolvedValue({
      success: true,
      output: 'looping...',
    });

    const result = await runAgentLoop(agentConfig, 'Loop forever', 'sess-006');

    expect(result.ok).toBe(true);
    expect(result.iterations).toBe(5); // maxIterations from config
    expect(result.response).toContain('max iterations');
  });
});

// =============================================================================
// LLM errors
// =============================================================================

describe('LLM call failure', () => {
  it('returns error result when LLM call fails', async () => {
    mockCallLLM.mockRejectedValueOnce(new Error('API key expired'));

    const result = await runAgentLoop(agentConfig, 'Try this', 'sess-007');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('API key expired');
    expect(result.iterations).toBe(1);
  });
});

// =============================================================================
// Malformed tool arguments
// =============================================================================

describe('malformed tool arguments', () => {
  it('handles invalid JSON in tool call arguments', async () => {
    mockCallLLM.mockResolvedValueOnce({
      content: null,
      toolCalls: [
        { id: 'tc-bad', name: 'file_read', arguments: 'NOT_JSON' },
      ],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
    });

    mockExecuteTool.mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'Missing path argument',
    });

    mockCallLLM.mockResolvedValueOnce({
      content: 'I made an error, trying again.',
      toolCalls: [],
      provider: 'gemini',
      model: 'gemini-3-flash',
      finishReason: 'STOP',
    });

    const result = await runAgentLoop(agentConfig, 'Do something', 'sess-008');

    expect(result.ok).toBe(true);
    // Tool should have been called with empty object as fallback
    expect(mockExecuteTool).toHaveBeenCalledWith('file_read', {}, expect.anything());
  });
});
