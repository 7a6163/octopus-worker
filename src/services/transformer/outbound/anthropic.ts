/**
 * Anthropic Messages outbound transformer
 * Corresponds to internal/transformer/outbound/anthropic/messages.go in the original Go project
 *
 * Core functionality:
 * 1. OpenAI format -> Anthropic format conversion
 * 2. Handle system prompts, tools, and thinking mode
 * 3. SSE streaming response conversion
 */

import type {
  InternalLLMRequest,
  InternalLLMResponse,
  Message,
  ToolCall,
  Usage,
} from '@/types/llm';
import type { OutboundTransformer } from '../interface';

// ==================== Anthropic API type definitions ====================

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: AnthropicSystemPrompt;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
  stop_sequences?: string[];
  thinking?: { type: string; budget_tokens: number };
  metadata?: { user_id?: string };
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContent;
}

type AnthropicContent = string | AnthropicContentBlock[];

interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  source?: {
    type: string;
    media_type?: string;
    data?: string;
    url?: string;
  };
  tool_use_id?: string;
  content?: AnthropicContent;
  is_error?: boolean;
  thinking?: string;
  signature?: string;
  cache_control?: { type: string };
}

interface AnthropicSystemPrompt {
  multiplePrompts?: Array<{
    type: string;
    text: string;
    cache_control?: { type: string };
  }>;
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  cache_control?: { type: string };
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

// ==================== Stream state tracking ====================

interface StreamState {
  streamId: string;
  streamModel: string;
  streamUsage: Usage | null;
  toolIndex: number;
  toolCalls: Map<number, ToolCall>;
  currentText: string;
  currentThinking: string;
  initialized: boolean;
}

// ==================== Main transformer class ====================

export class AnthropicOutbound implements OutboundTransformer {
  private streamState: StreamState | null = null;

  /**
   * Convert internal request to Anthropic Messages API request
   */
  async transformRequest(
    request: InternalLLMRequest,
    baseUrl: string,
    key: string
  ): Promise<Request> {
    const anthropicReq = this.convertToAnthropicRequest(request);

    // Build full URL
    const url = new URL(baseUrl.replace(/\/$/, ''));
    url.pathname = `${url.pathname}/messages`;

    // Pass through original query parameters
    if (request.query) {
      for (const [k, v] of request.query.entries()) {
        url.searchParams.set(k, v);
      }
    }

    // Set headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Anthropic-Version': '2023-06-01',
      'X-API-Key': key,
    };

    if (request.stream) {
      headers.Accept = 'text/event-stream';
    } else {
      headers.Accept = 'application/json';
    }

    return new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(anthropicReq),
    });
  }

  /**
   * Convert Anthropic response to internal format
   */
  async transformResponse(response: Response): Promise<InternalLLMResponse> {
    const text = await response.text();

    if (!text) {
      throw new Error('Response body is empty');
    }

    if (response.status >= 400) {
      const errResp = JSON.parse(text);
      if (errResp.error?.message) {
        throw new Error(`HTTP ${response.status}: ${errResp.error.message}`);
      }
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const anthropicResp = JSON.parse(text) as AnthropicResponse;
    return this.convertToInternalResponse(anthropicResp);
  }

  /**
   * Convert Anthropic SSE events to internal format
   */
  async transformStream(eventData: Uint8Array): Promise<InternalLLMResponse | null> {
    const text = new TextDecoder().decode(eventData);

    if (!text || text.trim() === '') {
      return null;
    }

    if (text.trim() === '[DONE]') {
      return { object: '[DONE]', choices: [] };
    }

    // Initialize stream state
    if (!this.streamState) {
      this.streamState = {
        streamId: '',
        streamModel: '',
        streamUsage: null,
        toolIndex: -1,
        toolCalls: new Map(),
        currentText: '',
        currentThinking: '',
        initialized: true,
      };
    }

    try {
      const event = JSON.parse(text);
      return this.handleStreamEvent(event);
    } catch (err) {
      console.warn('Failed to parse stream event:', text.slice(0, 100), err);
      return null;
    }
  }

  // ==================== Private helper methods ====================

  /**
   * Convert internal request to Anthropic format
   */
  private convertToAnthropicRequest(req: InternalLLMRequest): AnthropicRequest {
    const result: AnthropicRequest = {
      model: req.model,
      messages: this.convertMessages(req),
      max_tokens: this.resolveMaxTokens(req),
    };

    // System prompt
    const systemPrompt = this.extractSystemPrompt(req);
    if (systemPrompt) {
      result.system = systemPrompt;
    }

    // Optional parameters
    if (req.temperature !== undefined) result.temperature = req.temperature;
    if (req.topP !== undefined) result.top_p = req.topP;
    if (req.stream !== undefined) result.stream = req.stream;

    // Tools
    if (req.tools && req.tools.length > 0) {
      result.tools = req.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || {},
        cache_control: tool.cacheControl ? { type: tool.cacheControl.type } : undefined,
      }));
    }

    // Stop sequences
    if (req.stop) {
      result.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
    }

    // Thinking mode
    if (req.reasoningEffort) {
      result.thinking = {
        type: 'enabled',
        budget_tokens: this.getThinkingBudget(req.reasoningEffort, req.reasoningBudget),
      };
    }

    // Metadata
    if (req.metadata?.user_id) {
      result.metadata = { user_id: req.metadata.user_id };
    }

    return result;
  }

  /**
   * Resolve max_tokens
   */
  private resolveMaxTokens(req: InternalLLMRequest): number {
    if (req.maxTokens) return req.maxTokens;
    if (req.maxCompletionTokens) return req.maxCompletionTokens;
    return 8192; // Default
  }

  /**
   * Extract system prompt
   */
  private extractSystemPrompt(req: InternalLLMRequest): AnthropicSystemPrompt | undefined {
    const systemMessages = req.messages.filter((m) => m.role === 'system');
    if (systemMessages.length === 0) return undefined;

    return {
      multiplePrompts: systemMessages.map((msg) => ({
        type: 'text',
        text: msg.content.content || '',
        cache_control: msg.cacheControl ? { type: msg.cacheControl.type } : undefined,
      })),
    };
  }

  /**
   * Convert message array
   */
  private convertMessages(req: InternalLLMRequest): AnthropicMessage[] {
    const messages: AnthropicMessage[] = [];

    for (const msg of req.messages) {
      // Skip system messages (handled in system prompt)
      if (msg.role === 'system') continue;

      // Convert user/assistant messages
      if (msg.role === 'user') {
        messages.push({
          role: 'user',
          content: this.convertMessageContent(msg),
        });
      } else if (msg.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: this.convertAssistantContent(msg),
        });
      } else if (msg.role === 'tool') {
        // Tool responses need to be appended to previous assistant message or create a new user message
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId || 'unknown',
              content: msg.content.content || '',
              is_error: msg.toolCallIsError || false,
            },
          ],
        });
      }
    }

    return messages;
  }

  /**
   * Convert message content
   */
  private convertMessageContent(msg: Message): AnthropicContent {
    // Simple text
    if (msg.content.content && !msg.content.multipleContent) {
      return msg.content.content;
    }

    // Multi-part content
    if (msg.content.multipleContent) {
      const blocks: AnthropicContentBlock[] = [];

      for (const part of msg.content.multipleContent) {
        if (part.type === 'text' && part.text) {
          blocks.push({
            type: 'text',
            text: part.text,
            cache_control: part.cacheControl ? { type: part.cacheControl.type } : undefined,
          });
        } else if (part.type === 'image_url' && part.imageUrl) {
          // Simplified image handling
          blocks.push({
            type: 'image',
            source: {
              type: 'url',
              url: part.imageUrl.url,
            },
          });
        }
      }

      return blocks;
    }

    return '';
  }

  /**
   * Convert assistant content
   */
  private convertAssistantContent(msg: Message): AnthropicContent {
    const blocks: AnthropicContentBlock[] = [];

    // Thinking content
    if (msg.reasoningContent) {
      blocks.push({
        type: 'thinking',
        thinking: msg.reasoningContent,
        signature: msg.reasoningSignature || '',
      });
    }

    // Text content
    if (msg.content.content) {
      blocks.push({
        type: 'text',
        text: msg.content.content,
        cache_control: msg.cacheControl ? { type: msg.cacheControl.type } : undefined,
      });
    }

    // Multi-part content
    if (msg.content.multipleContent) {
      for (const part of msg.content.multipleContent) {
        if (part.type === 'text' && part.text) {
          blocks.push({
            type: 'text',
            text: part.text,
            cache_control: part.cacheControl ? { type: part.cacheControl.type } : undefined,
          });
        }
      }
    }

    // Tool calls
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const toolCall of msg.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments),
          cache_control: toolCall.cacheControl ? { type: toolCall.cacheControl.type } : undefined,
        });
      }
    }

    return blocks.length === 1 && blocks[0]?.type === 'text' ? blocks[0].text || '' : blocks;
  }

  /**
   * Thinking budget
   */
  private getThinkingBudget(effort: string, budget?: number): number {
    if (budget) return budget;
    const budgets: Record<string, number> = {
      low: 1024,
      medium: 8192,
      high: 32768,
    };
    return budgets[effort] || 8192;
  }

  /**
   * Convert Anthropic response to internal format
   */
  private convertToInternalResponse(resp: AnthropicResponse): InternalLLMResponse {
    const content: string[] = [];
    const toolCalls: ToolCall[] = [];
    let reasoningContent = '';

    for (const block of resp.content) {
      if (block.type === 'text' && block.text) {
        content.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id || '',
          type: 'function',
          function: {
            name: block.name || '',
            arguments: JSON.stringify(block.input || {}),
          },
        });
      } else if (block.type === 'thinking' && block.thinking) {
        reasoningContent = block.thinking;
      }
    }

    return {
      id: resp.id,
      model: resp.model,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: {
              content: content.join(''),
            },
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            reasoningContent: reasoningContent || undefined,
          },
          finishReason: this.convertStopReason(resp.stop_reason),
        },
      ],
      usage: this.convertUsage(resp.usage),
    };
  }

  /**
   * Handle stream event
   */
  private handleStreamEvent(event: any): InternalLLMResponse | null {
    if (!this.streamState) return null;

    const resp: InternalLLMResponse = {
      id: this.streamState.streamId,
      model: this.streamState.streamModel,
      object: 'chat.completion.chunk',
      created: 0,
      choices: [],
    };

    switch (event.type) {
      case 'message_start':
        if (event.message) {
          this.streamState.streamId = event.message.id;
          this.streamState.streamModel = event.message.model;
          resp.id = event.message.id;
          resp.model = event.message.model;

          if (event.message.usage) {
            this.streamState.streamUsage = this.convertUsage(event.message.usage);
          }

          resp.choices = [
            {
              index: 0,
              delta: { role: 'assistant', content: { content: '' } },
            },
          ];
        }
        break;

      case 'content_block_start':
        if (event.content_block?.type === 'tool_use') {
          this.streamState.toolIndex++;
          this.streamState.toolCalls.set(this.streamState.toolIndex, {
            id: event.content_block.id || '',
            type: 'function',
            function: { name: event.content_block.name || '', arguments: '' },
          });
          resp.choices = [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: {},
                toolCalls: [
                  {
                    id: event.content_block.id || '',
                    type: 'function',
                    function: { name: event.content_block.name || '', arguments: '' },
                    index: this.streamState.toolIndex,
                  },
                ],
              },
            },
          ];
        } else {
          return null;
        }
        break;

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          resp.choices = [
            {
              index: 0,
              delta: { role: 'assistant', content: { content: event.delta.text } },
            },
          ];
        } else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
          resp.choices = [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: {},
                reasoningContent: event.delta.thinking,
              },
            },
          ];
        } else if (event.delta?.type === 'signature_delta') {
          // Signature is part of thinking block — skip for internal format
          return null;
        } else if (
          event.delta?.type === 'input_json_delta' &&
          event.delta.partial_json !== undefined
        ) {
          const tc = this.streamState.toolCalls.get(this.streamState.toolIndex);
          if (tc) {
            resp.choices = [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: {},
                  toolCalls: [
                    {
                      id: tc.id,
                      type: 'function',
                      function: { name: '', arguments: event.delta.partial_json },
                      index: this.streamState.toolIndex,
                    },
                  ],
                },
              },
            ];
          } else {
            return null;
          }
        } else {
          return null;
        }
        break;

      case 'message_delta':
        if (event.usage) {
          const usage = this.convertUsage(event.usage);
          if (this.streamState.streamUsage) {
            usage.promptTokens = this.streamState.streamUsage.promptTokens;
            usage.totalTokens = usage.promptTokens + usage.completionTokens;
          }
          this.streamState.streamUsage = usage;
        }
        if (event.delta?.stop_reason) {
          resp.choices = [
            {
              index: 0,
              finishReason: this.convertStopReason(event.delta.stop_reason),
            },
          ];
        }
        break;

      case 'message_stop':
        resp.choices = [];
        if (this.streamState.streamUsage) {
          resp.usage = this.streamState.streamUsage;
        }
        break;

      case 'content_block_stop':
      case 'ping':
        return null;

      default:
        return null;
    }

    return resp;
  }

  /**
   * Convert stop_reason
   */
  private convertStopReason(stopReason: string): string {
    const mapping: Record<string, string> = {
      end_turn: 'stop',
      max_tokens: 'length',
      stop_sequence: 'stop',
      tool_use: 'tool_calls',
    };
    return mapping[stopReason] || stopReason;
  }

  /**
   * Convert usage
   */
  private convertUsage(usage: any): Usage {
    return {
      promptTokens: usage.input_tokens || 0,
      completionTokens: usage.output_tokens || 0,
      totalTokens:
        (usage.input_tokens || 0) +
        (usage.output_tokens || 0) +
        (usage.cache_read_input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0),
      cacheCreationInputTokens: usage.cache_creation_input_tokens,
      cacheReadInputTokens: usage.cache_read_input_tokens,
      promptTokensDetails: usage.cache_read_input_tokens
        ? { cachedTokens: usage.cache_read_input_tokens }
        : undefined,
      anthropicUsage: true,
    };
  }
}
