/**
 * Anthropic Messages Inbound 轉換器
 * 對應原始 Go 專案的 internal/transformer/inbound/anthropic/messages.go
 */

import type { InternalLLMRequest, InternalLLMResponse, Message, ToolCall } from '@/types/llm';
import type { InboundTransformer } from '../interface';

interface AnthropicRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content:
      | string
      | Array<{
          type: string;
          text?: string;
          thinking?: string;
          signature?: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string | Array<{ type: string; text?: string }>;
          is_error?: boolean;
          cache_control?: { type: string };
          source?: { type: string; media_type?: string; data?: string; url?: string };
          [key: string]: any;
        }>;
  }>;
  system?:
    | string
    | Array<{ type: string; text: string; cache_control?: { type: string }; [key: string]: any }>;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema?: Record<string, unknown>;
    cache_control?: { type: string };
  }>;
  stop_sequences?: string[];
  thinking?: {
    type: string;
    budget_tokens?: number;
    output_config?: { effort?: string };
  };
  metadata?: { user_id?: string };
}

interface InboundStreamState {
  contentBlockIndex: number;
  hasThinkingStarted: boolean;
  hasTextStarted: boolean;
  currentToolCalls: Map<number, ToolCall>;
}

export class AnthropicInbound implements InboundTransformer {
  private lastResponse: InternalLLMResponse | null = null;
  private streamState: InboundStreamState | null = null;

  /**
   * 將客戶端 Anthropic 格式請求轉換為內部格式
   */
  async transformRequest(body: ArrayBuffer): Promise<InternalLLMRequest> {
    const text = new TextDecoder().decode(body);

    if (!text) {
      throw new Error('Request body is empty');
    }

    try {
      const req = JSON.parse(text) as AnthropicRequest;

      // 驗證必要欄位
      if (!req.model) {
        throw new Error('model is required');
      }

      if (!req.max_tokens) {
        throw new Error('max_tokens is required');
      }

      if (!req.messages || !Array.isArray(req.messages)) {
        throw new Error('messages is required and must be an array');
      }

      // 轉換為內部格式
      const internalReq: InternalLLMRequest = {
        model: req.model,
        messages: this.convertMessages(req),
        maxTokens: req.max_tokens,
        temperature: req.temperature,
        topP: req.top_p,
        stream: req.stream,
      };

      // System prompt
      if (req.system) {
        if (typeof req.system === 'string') {
          internalReq.messages.unshift({
            role: 'system',
            content: { content: req.system },
          });
        } else if (Array.isArray(req.system)) {
          // Multiple system blocks — combine text, preserve last cache_control
          const texts: string[] = [];
          let lastCacheControl: { type: string } | undefined;
          for (const block of req.system) {
            if (block.text) texts.push(block.text);
            if (block.cache_control) lastCacheControl = block.cache_control;
          }
          const systemMsg: Message = {
            role: 'system',
            content: { content: texts.join('\n') },
          };
          if (lastCacheControl) {
            systemMsg.cacheControl = { type: lastCacheControl.type as 'ephemeral' };
          }
          internalReq.messages.unshift(systemMsg);
        }
      }

      // Tools
      if (req.tools && req.tools.length > 0) {
        internalReq.tools = req.tools.map((tool) => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
          cacheControl: tool.cache_control
            ? { type: tool.cache_control.type as 'ephemeral' }
            : undefined,
        }));
      }

      // Stop sequences
      if (req.stop_sequences && req.stop_sequences.length > 0) {
        internalReq.stop = req.stop_sequences;
      }

      // Thinking
      if (req.thinking) {
        if (req.thinking.type === 'adaptive' && req.thinking.output_config?.effort) {
          internalReq.reasoningEffort = req.thinking.output_config.effort;
        } else if (req.thinking.type === 'enabled' && req.thinking.budget_tokens) {
          internalReq.reasoningEffort = thinkingBudgetToEffort(req.thinking.budget_tokens);
          internalReq.reasoningBudget = req.thinking.budget_tokens;
        } else {
          internalReq.reasoningEffort = 'medium';
        }
      }

      // Metadata
      if (req.metadata?.user_id) {
        internalReq.metadata = { user_id: req.metadata.user_id };
      }

      return internalReq;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${err.message}`);
      }
      throw err;
    }
  }

  /**
   * 將內部格式回應轉換為 Anthropic 格式
   */
  async transformResponse(response: InternalLLMResponse): Promise<Uint8Array> {
    this.lastResponse = response;

    // 轉換為 Anthropic 格式
    const anthropicResp = this.convertToAnthropicResponse(response);

    const text = JSON.stringify(anthropicResp);
    return new TextEncoder().encode(text);
  }

  /**
   * 將內部流式回應轉換為 Anthropic SSE 格式
   */
  async transformStream(stream: InternalLLMResponse): Promise<Uint8Array | null> {
    this.lastResponse = stream;

    if (!this.streamState) {
      this.streamState = {
        contentBlockIndex: -1,
        hasThinkingStarted: false,
        hasTextStarted: false,
        currentToolCalls: new Map(),
      };
    }

    // [DONE] 訊號
    if (stream.object === '[DONE]') {
      const events: Array<{ type: string; data: unknown }> = [];
      // Close any open content blocks
      if (this.streamState.hasTextStarted || this.streamState.hasThinkingStarted) {
        events.push({
          type: 'content_block_stop',
          data: { type: 'content_block_stop', index: this.streamState.contentBlockIndex },
        });
      }
      events.push({ type: 'message_stop', data: { type: 'message_stop' } });
      return new TextEncoder().encode(
        `${events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n`).join('\n')}\n`
      );
    }

    // 轉換為 Anthropic 流式事件
    const events = this.convertToAnthropicStreamEvents(stream);

    if (!events || events.length === 0) {
      return null;
    }

    const lines = events.map(
      (event) => `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n`
    );
    return new TextEncoder().encode(`${lines.join('\n')}\n`);
  }

  /**
   * 取得最後的內部回應
   */
  getInternalResponse(): InternalLLMResponse | null {
    return this.lastResponse;
  }

  // ==================== 私有輔助方法 ====================

  /**
   * 轉換訊息陣列
   */
  private convertMessages(req: AnthropicRequest): Message[] {
    const result: Message[] = [];

    for (const msg of req.messages) {
      if (typeof msg.content === 'string') {
        result.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: { content: msg.content },
        });
        continue;
      }

      // Content is an array of blocks
      if (msg.role === 'assistant') {
        const assistantMsg: Message = {
          role: 'assistant',
          content: {},
        };
        const textParts: string[] = [];

        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          } else if (block.type === 'thinking' && block.thinking) {
            assistantMsg.reasoningContent = block.thinking;
            assistantMsg.reasoningSignature = block.signature;
          } else if (block.type === 'tool_use') {
            if (!assistantMsg.toolCalls) assistantMsg.toolCalls = [];
            assistantMsg.toolCalls.push({
              id: block.id || '',
              type: 'function',
              function: {
                name: block.name || '',
                arguments: JSON.stringify(block.input || {}),
              },
              cacheControl: block.cache_control
                ? { type: block.cache_control.type as 'ephemeral' }
                : undefined,
            });
          }
        }

        if (textParts.length > 0) {
          assistantMsg.content = { content: textParts.join('') };
        }
        result.push(assistantMsg);
      } else {
        // User messages — may contain text, images, or tool_result
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            const toolContent =
              typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((c) => c.text || '').join('')
                  : '';
            result.push({
              role: 'tool',
              content: { content: toolContent },
              toolCallId: block.tool_use_id,
              toolCallIsError: block.is_error || false,
              cacheControl: block.cache_control
                ? { type: block.cache_control.type as 'ephemeral' }
                : undefined,
            });
          } else if (block.type === 'text' && block.text) {
            result.push({
              role: 'user',
              content: { content: block.text },
              cacheControl: block.cache_control
                ? { type: block.cache_control.type as 'ephemeral' }
                : undefined,
            });
          } else if (block.type === 'image' && block.source) {
            result.push({
              role: 'user',
              content: {
                multipleContent: [
                  {
                    type: 'image_url',
                    imageUrl: {
                      url:
                        block.source.url ||
                        `data:${block.source.media_type};base64,${block.source.data}`,
                    },
                  },
                ],
              },
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * 轉換為 Anthropic 回應格式
   */
  private convertToAnthropicResponse(response: InternalLLMResponse): any {
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No choices in response');
    }

    const content: any[] = [];

    // Thinking 內容
    if (choice.message?.reasoningContent) {
      content.push({
        type: 'thinking',
        thinking: choice.message.reasoningContent,
        signature: choice.message.reasoningSignature || '',
      });
    }

    // 文字內容
    if (choice.message?.content?.content) {
      content.push({
        type: 'text',
        text: choice.message.content.content,
      });
    }

    // Tool calls
    if (choice.message?.toolCalls) {
      for (const toolCall of choice.message.toolCalls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments),
        });
      }
    }

    return {
      id: response.id,
      type: 'message',
      role: 'assistant',
      model: response.model,
      content,
      stop_reason: this.convertFinishReason(choice.finishReason || 'stop'),
      usage: response.usage
        ? {
            input_tokens: response.usage.promptTokens,
            output_tokens: response.usage.completionTokens,
            cache_creation_input_tokens: response.usage.cacheCreationInputTokens,
            cache_read_input_tokens: response.usage.cacheReadInputTokens,
          }
        : undefined,
    };
  }

  /**
   * 轉換為 Anthropic 流式事件
   */
  private convertToAnthropicStreamEvents(
    stream: InternalLLMResponse
  ): Array<{ type: string; data: unknown }> {
    const events: Array<{ type: string; data: unknown }> = [];
    const choice = stream.choices[0];
    const state = this.streamState!;

    if (!choice) {
      return [];
    }

    // message_start 事件
    if (choice.delta?.role === 'assistant') {
      events.push({
        type: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: stream.id,
            type: 'message',
            role: 'assistant',
            model: stream.model,
            content: [],
            stop_reason: null,
            usage: stream.usage
              ? {
                  input_tokens: stream.usage.promptTokens,
                  output_tokens: 0,
                  cache_creation_input_tokens: stream.usage.cacheCreationInputTokens,
                  cache_read_input_tokens: stream.usage.cacheReadInputTokens,
                }
              : undefined,
          },
        },
      });
    }

    // Thinking/reasoning content
    if (choice.delta?.reasoningContent) {
      if (!state.hasThinkingStarted) {
        state.contentBlockIndex++;
        state.hasThinkingStarted = true;
        events.push({
          type: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: state.contentBlockIndex,
            content_block: { type: 'thinking', thinking: '' },
          },
        });
      }
      events.push({
        type: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: state.contentBlockIndex,
          delta: { type: 'thinking_delta', thinking: choice.delta.reasoningContent },
        },
      });
    }

    // Text content
    if (choice.delta?.content?.content) {
      // Close thinking block if transitioning
      if (state.hasThinkingStarted && !state.hasTextStarted) {
        events.push({
          type: 'content_block_stop',
          data: { type: 'content_block_stop', index: state.contentBlockIndex },
        });
        state.hasThinkingStarted = false;
      }

      if (!state.hasTextStarted) {
        state.contentBlockIndex++;
        state.hasTextStarted = true;
        events.push({
          type: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: state.contentBlockIndex,
            content_block: { type: 'text', text: '' },
          },
        });
      }
      events.push({
        type: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: state.contentBlockIndex,
          delta: { type: 'text_delta', text: choice.delta.content.content },
        },
      });
    }

    // Tool calls
    if (choice.delta?.toolCalls) {
      // Close text block if transitioning
      if (state.hasTextStarted) {
        events.push({
          type: 'content_block_stop',
          data: { type: 'content_block_stop', index: state.contentBlockIndex },
        });
        state.hasTextStarted = false;
      }

      for (const tc of choice.delta.toolCalls) {
        const tcIndex = tc.index ?? state.contentBlockIndex + 1;
        if (!state.currentToolCalls.has(tcIndex)) {
          state.contentBlockIndex++;
          state.currentToolCalls.set(tcIndex, tc);
          events.push({
            type: 'content_block_start',
            data: {
              type: 'content_block_start',
              index: state.contentBlockIndex,
              content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: {} },
            },
          });
        }
        if (tc.function.arguments) {
          events.push({
            type: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: state.contentBlockIndex,
              delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
            },
          });
        }
      }
    }

    // message_delta 事件
    if (choice.finishReason || stream.usage) {
      // Close any open content blocks
      if (state.hasTextStarted) {
        events.push({
          type: 'content_block_stop',
          data: { type: 'content_block_stop', index: state.contentBlockIndex },
        });
        state.hasTextStarted = false;
      }

      events.push({
        type: 'message_delta',
        data: {
          type: 'message_delta',
          delta: {
            stop_reason: this.convertFinishReason(choice.finishReason || ''),
          },
          usage: stream.usage ? { output_tokens: stream.usage.completionTokens } : undefined,
        },
      });
    }

    return events;
  }

  /**
   * 轉換 finishReason
   */
  private convertFinishReason(reason: string): string {
    const mapping: Record<string, string> = {
      stop: 'end_turn',
      length: 'max_tokens',
      tool_calls: 'tool_use',
      content_filter: 'stop_sequence',
    };
    return mapping[reason] || 'end_turn';
  }
}

/**
 * 將 Anthropic thinking budget_tokens 對應到 reasoning effort
 */
function thinkingBudgetToEffort(budgetTokens: number): string {
  if (budgetTokens <= 2048) return 'low';
  if (budgetTokens <= 16384) return 'medium';
  return 'high';
}
