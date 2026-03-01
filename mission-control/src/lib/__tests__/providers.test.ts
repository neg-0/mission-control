/**
 * @module providers.test
 * @description
 * Unit tests for the multi-provider LLM client.
 * Tests OpenAI, Gemini, and Anthropic adapters plus failover logic.
 */

import {
  buildProviderConfig,
  callLLM,
  type ChatMessage,
  type ProviderConfig,
  type ToolDefinition,
} from '../agent-runtime/providers';

// =============================================================================
// Mock fetch globally
// =============================================================================

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

// =============================================================================
// Test Data
// =============================================================================

const simpleMessages: ChatMessage[] = [
  { role: 'system', content: 'You are a helper.' },
  { role: 'user', content: 'Hello' },
];

const toolDefs: ToolDefinition[] = [
  {
    name: 'file_read',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

// =============================================================================
// buildProviderConfig
// =============================================================================

describe('buildProviderConfig', () => {
  it('creates config with defaults', () => {
    const config = buildProviderConfig('openai', 'gpt-5.2-codex');
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-5.2-codex');
    expect(config.maxTokens).toBe(4096);
    expect(config.temperature).toBe(0.7);
  });

  it('applies overrides', () => {
    const config = buildProviderConfig('gemini', 'gemini-3-flash', {
      maxTokens: 8192,
      temperature: 0.3,
    });
    expect(config.maxTokens).toBe(8192);
    expect(config.temperature).toBe(0.3);
  });
});

// =============================================================================
// OpenAI Provider
// =============================================================================

describe('OpenAI provider', () => {
  const config: ProviderConfig = {
    provider: 'openai',
    model: 'gpt-5.2-codex',
  };

  it('formats request correctly and parses text response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const result = await callLLM(simpleMessages, [], config);

    expect(result.content).toBe('Hello!');
    expect(result.toolCalls).toEqual([]);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-5.2-codex');
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(5);
    expect(result.finishReason).toBe('stop');

    // Verify fetch was called with correct structure
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer test-openai-key');

    const body = JSON.parse(opts.body);
    expect(body.model).toBe('gpt-5.2-codex');
    expect(body.messages).toHaveLength(2);
  });

  it('parses tool call response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'file_read',
                    arguments: '{"path":"test.md"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }),
    });

    const result = await callLLM(simpleMessages, toolDefs, config);

    expect(result.content).toBeNull();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].id).toBe('call_123');
    expect(result.toolCalls[0].name).toBe('file_read');
    expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({ path: 'test.md' });
  });

  it('includes tools in request when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    });

    await callLLM(simpleMessages, toolDefs, config);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('file_read');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    await expect(callLLM(simpleMessages, [], config)).rejects.toThrow(
      'OpenAI API error 429',
    );
  });

  it('throws when no API key configured', async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(callLLM(simpleMessages, [], config)).rejects.toThrow(
      'OpenAI API key not configured',
    );
  });
});

// =============================================================================
// Gemini Provider
// =============================================================================

describe('Gemini provider', () => {
  const config: ProviderConfig = {
    provider: 'gemini',
    model: 'gemini-3-flash',
  };

  it('formats request correctly and parses text response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: 'Gemini says hi!' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 4,
          totalTokenCount: 12,
        },
      }),
    });

    const result = await callLLM(simpleMessages, [], config);

    expect(result.content).toBe('Gemini says hi!');
    expect(result.toolCalls).toEqual([]);
    expect(result.provider).toBe('gemini');
    expect(result.usage?.promptTokens).toBe(8);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('gemini-3-flash:generateContent');
    expect(url).toContain('key=test-gemini-key');
  });

  it('parses function call response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: 'file_read', args: { path: 'test.md' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    });

    const result = await callLLM(simpleMessages, toolDefs, config);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('file_read');
    expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({ path: 'test.md' });
  });

  it('separates system instruction from contents', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
      }),
    });

    await callLLM(simpleMessages, [], config);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.systemInstruction).toBeDefined();
    expect(body.systemInstruction.parts[0].text).toBe('You are a helper.');
    // User message should be in contents, not system
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe('user');
  });
});

// =============================================================================
// Anthropic Provider
// =============================================================================

describe('Anthropic provider', () => {
  const config: ProviderConfig = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  };

  it('formats request and parses text response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Claude says hello!' }],
        usage: { input_tokens: 12, output_tokens: 6 },
        stop_reason: 'end_turn',
      }),
    });

    const result = await callLLM(simpleMessages, [], config);

    expect(result.content).toBe('Claude says hello!');
    expect(result.provider).toBe('anthropic');
    expect(result.usage?.promptTokens).toBe(12);
    expect(result.usage?.completionTokens).toBe(6);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('test-anthropic-key');
    expect(opts.headers['anthropic-version']).toBe('2024-01-01');

    const body = JSON.parse(opts.body);
    expect(body.system).toBe('You are a helper.');
    expect(body.messages).toHaveLength(1); // system is extracted
  });

  it('parses tool_use response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'file_read',
            input: { path: 'test.md' },
          },
        ],
        stop_reason: 'tool_use',
      }),
    });

    const result = await callLLM(simpleMessages, toolDefs, config);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].id).toBe('toolu_abc');
    expect(result.toolCalls[0].name).toBe('file_read');
  });

  it('sends tools as input_schema format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      }),
    });

    await callLLM(simpleMessages, toolDefs, config);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].input_schema).toBeDefined();
    expect(body.tools[0].name).toBe('file_read');
  });
});

// =============================================================================
// Failover
// =============================================================================

describe('callLLM failover', () => {
  const primary: ProviderConfig = { provider: 'openai', model: 'gpt-5.2-codex' };
  const fallback: ProviderConfig = { provider: 'gemini', model: 'gemini-3-flash' };

  it('uses fallback when primary fails', async () => {
    // Primary fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    // Fallback succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: 'Fallback response' }] }, finishReason: 'STOP' },
        ],
      }),
    });

    const result = await callLLM(simpleMessages, [], primary, fallback);

    expect(result.content).toBe('Fallback response');
    expect(result.provider).toBe('gemini');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws combined error when both fail', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Primary down',
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Fallback down',
    });

    await expect(callLLM(simpleMessages, [], primary, fallback)).rejects.toThrow(
      'Both providers failed',
    );
  });

  it('throws primary error when no fallback configured', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    await expect(callLLM(simpleMessages, [], primary)).rejects.toThrow(
      'OpenAI API error 429',
    );
  });
});
