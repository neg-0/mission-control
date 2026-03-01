/**
 * @module providers
 * @description
 * Multi-provider LLM client for the MC native agent runtime.
 * Supports OpenAI (Codex OAuth + API), Google Gemini (API key),
 * and Anthropic Claude (API key) with automatic failover.
 *
 * Provides a unified interface for sending messages with tool definitions
 * and receiving responses (text or tool_calls), regardless of provider.
 */

// =============================================================================
// Shared Types
// =============================================================================

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string | null;
  /** For assistant messages that include tool calls */
  toolCalls?: ToolCall[];
  /** For tool-result messages */
  toolCallId?: string;
  /** Name of the tool (for tool results) */
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  provider: string;
  model: string;
  finishReason: string;
}

export interface ProviderConfig {
  provider: 'openai' | 'gemini' | 'anthropic';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

// =============================================================================
// Provider Interface
// =============================================================================

interface LLMProvider {
  readonly name: string;
  chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: ProviderConfig,
  ): Promise<LLMResponse>;
}

// =============================================================================
// OpenAI Provider (Codex OAuth + API)
// =============================================================================

const openaiProvider: LLMProvider = {
  name: 'openai',

  async chat(messages, tools, config): Promise<LLMResponse> {
    const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    const body: Record<string, unknown> = {
      model: config.model,
      messages: messages.map((m) => formatOpenAIMessage(m)),
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
    };

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('OpenAI returned no choices');

    const toolCalls: ToolCall[] = (choice.message?.tool_calls || []).map(
      (tc: { id: string; function: { name: string; arguments: string } }) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }),
    );

    return {
      content: choice.message?.content || null,
      toolCalls,
      usage: data.usage
        ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
        : undefined,
      provider: 'openai',
      model: config.model,
      finishReason: choice.finish_reason || 'stop',
    };
  },
};

function formatOpenAIMessage(msg: ChatMessage): Record<string, unknown> {
  const formatted: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
  };

  if (msg.role === 'assistant' && msg.toolCalls?.length) {
    formatted.tool_calls = msg.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }

  if (msg.role === 'tool') {
    formatted.tool_call_id = msg.toolCallId;
    formatted.name = msg.name;
  }

  return formatted;
}

// =============================================================================
// Gemini Provider (API Key)
// =============================================================================

const geminiProvider: LLMProvider = {
  name: 'gemini',

  async chat(messages, tools, config): Promise<LLMResponse> {
    const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key not configured');

    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

    // Gemini uses a different message format
    const { systemInstruction, contents } = formatGeminiMessages(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: config.maxTokens || 4096,
        temperature: config.temperature ?? 0.7,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    if (tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const res = await fetch(
      `${baseUrl}/models/${config.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('Gemini returned no candidates');

    let content: string | null = null;
    const toolCalls: ToolCall[] = [];

    for (const part of candidate.content?.parts || []) {
      if (part.text) {
        content = (content || '') + part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: data.usageMetadata
        ? {
          promptTokens: data.usageMetadata.promptTokenCount || 0,
          completionTokens: data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata.totalTokenCount || 0,
        }
        : undefined,
      provider: 'gemini',
      model: config.model,
      finishReason: candidate.finishReason || 'STOP',
    };
  },
};

function formatGeminiMessages(messages: ChatMessage[]): {
  systemInstruction: string | null;
  contents: Array<Record<string, unknown>>;
} {
  let systemInstruction: string | null = null;
  const contents: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = (systemInstruction || '') + (msg.content || '');
      continue;
    }

    if (msg.role === 'tool') {
      // Gemini uses functionResponse
      contents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: msg.name,
              response: { result: msg.content },
            },
          },
        ],
      });
      continue;
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      // Assistant message with function calls
      const parts: Array<Record<string, unknown>> = [];
      if (msg.content) parts.push({ text: msg.content });
      for (const tc of msg.toolCalls) {
        parts.push({
          functionCall: {
            name: tc.name,
            args: JSON.parse(tc.arguments),
          },
        });
      }
      contents.push({ role: 'model', parts });
      continue;
    }

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content || '' }],
    });
  }

  return { systemInstruction, contents };
}

// =============================================================================
// Anthropic Provider (API Key)
// =============================================================================

const anthropicProvider: LLMProvider = {
  name: 'anthropic',

  async chat(messages, tools, config): Promise<LLMResponse> {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Anthropic API key not configured');

    const baseUrl = 'https://api.anthropic.com/v1';

    // Anthropic has a separate system param
    const { system, formattedMessages } = formatAnthropicMessages(messages);

    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: config.maxTokens || 4096,
      messages: formattedMessages,
      temperature: config.temperature ?? 0.7,
    };

    if (system) body.system = system;

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2024-01-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    let content: string | null = null;
    const toolCalls: ToolCall[] = [];

    for (const block of data.content || []) {
      if (block.type === 'text') {
        content = (content || '') + block.text;
      }
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: data.usage
        ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        }
        : undefined,
      provider: 'anthropic',
      model: config.model,
      finishReason: data.stop_reason || 'end_turn',
    };
  },
};

function formatAnthropicMessages(messages: ChatMessage[]): {
  system: string | null;
  formattedMessages: Array<Record<string, unknown>>;
} {
  let system: string | null = null;
  const formattedMessages: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = (system || '') + (msg.content || '');
      continue;
    }

    if (msg.role === 'tool') {
      formattedMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId,
            content: msg.content || '',
          },
        ],
      });
      continue;
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      const content: Array<Record<string, unknown>> = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const tc of msg.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: JSON.parse(tc.arguments),
        });
      }
      formattedMessages.push({ role: 'assistant', content });
      continue;
    }

    formattedMessages.push({
      role: msg.role,
      content: msg.content || '',
    });
  }

  return { system, formattedMessages };
}

// =============================================================================
// Provider Registry & Failover Client
// =============================================================================

const providers: Record<string, LLMProvider> = {
  openai: openaiProvider,
  gemini: geminiProvider,
  anthropic: anthropicProvider,
};

/**
 * Call an LLM with automatic failover.
 * Tries the primary provider first; if it fails, tries the fallback.
 */
export async function callLLM(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  primary: ProviderConfig,
  fallback?: ProviderConfig,
): Promise<LLMResponse> {
  const primaryProvider = providers[primary.provider];
  if (!primaryProvider) {
    throw new Error(`Unknown provider: ${primary.provider}`);
  }

  try {
    return await primaryProvider.chat(messages, tools, primary);
  } catch (err) {
    const primaryError = err instanceof Error ? err.message : String(err);
    console.error(`[AgentRuntime] Primary provider (${primary.provider}/${primary.model}) failed: ${primaryError}`);

    if (fallback) {
      const fallbackProvider = providers[fallback.provider];
      if (!fallbackProvider) {
        throw new Error(
          `Primary provider failed: ${primaryError}. Fallback provider unknown: ${fallback.provider}`,
        );
      }

      console.log(`[AgentRuntime] Falling back to ${fallback.provider}/${fallback.model}`);
      try {
        return await fallbackProvider.chat(messages, tools, fallback);
      } catch (fallbackErr) {
        const fbError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        throw new Error(
          `Both providers failed. Primary (${primary.provider}): ${primaryError}. Fallback (${fallback.provider}): ${fbError}`,
        );
      }
    }

    throw err;
  }
}

/**
 * Build a ProviderConfig from agent DB fields.
 */
export function buildProviderConfig(
  provider: string,
  model: string,
  overrides?: Partial<ProviderConfig>,
): ProviderConfig {
  return {
    provider: provider as ProviderConfig['provider'],
    model,
    maxTokens: overrides?.maxTokens || 4096,
    temperature: overrides?.temperature ?? 0.7,
    apiKey: overrides?.apiKey,
    baseUrl: overrides?.baseUrl,
  };
}
