/**
 * Anthropic Messages Outbound 轉換器
 * 對應原始 Go 專案的 internal/transformer/outbound/authropic/messages.go
 *
 * 核心功能：
 * 1. OpenAI 格式 → Anthropic 格式轉換
 * 2. 處理 system prompts、tools、thinking 模式
 * 3. SSE 流式回應轉換
 */

import type { OutboundTransformer } from '../interface';
import type {
  InternalLLMRequest,
  InternalLLMResponse,
  Message,
  Usage,
  ToolCall,
} from '@/types/llm';

// ==================== Anthropic API 類型定義 ====================

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

// ==================== 流式狀態追蹤 ====================

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

// ==================== 主要轉換器類別 ====================

export class AnthropicOutbound implements OutboundTransformer {
  private streamState: StreamState | null = null;

  /**
   * 將內部請求轉換為 Anthropic Messages API 請求
   */
  async transformRequest(
    request: InternalLLMRequest,
    baseUrl: string,
    key: string
  ): Promise<Request> {
    const anthropicReq = this.convertToAnthropicRequest(request);

    // 構建完整 URL
    const url = new URL(baseUrl.replace(/\/$/, ''));
    url.pathname = url.pathname + '/messages';

    // 傳遞原始查詢參數
    if (request.query) {
      for (const [k, v] of request.query.entries()) {
        url.searchParams.set(k, v);
      }
    }

    // 設定 Headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Anthropic-Version': '2023-06-01',
      'X-API-Key': key,
    };

    if (request.stream) {
      headers['Accept'] = 'text/event-stream';
    } else {
      headers['Accept'] = 'application/json';
    }

    return new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(anthropicReq),
    });
  }

  /**
   * 將 Anthropic 回應轉換為內部格式
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
   * 將 Anthropic SSE 事件轉換為內部格式
   */
  async transformStream(eventData: Uint8Array): Promise<InternalLLMResponse | null> {
    const text = new TextDecoder().decode(eventData);

    if (!text || text.trim() === '') {
      return null;
    }

    if (text.trim() === '[DONE]') {
      return { object: '[DONE]', choices: [] };
    }

    // 初始化流式狀態
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

  // ==================== 私有輔助方法 ====================

  /**
   * 將內部請求轉換為 Anthropic 格式
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

    // 可選參數
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

    // Thinking 模式
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
   * 解析 max_tokens
   */
  private resolveMaxTokens(req: InternalLLMRequest): number {
    if (req.maxTokens) return req.maxTokens;
    if (req.maxCompletionTokens) return req.maxCompletionTokens;
    return 8192; // 預設值
  }

  /**
   * 提取 system prompt
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
   * 轉換訊息陣列
   */
  private convertMessages(req: InternalLLMRequest): AnthropicMessage[] {
    const messages: AnthropicMessage[] = [];

    for (const msg of req.messages) {
      // 跳過 system 訊息（已在 system prompt 處理）
      if (msg.role === 'system') continue;

      // 轉換 user/assistant 訊息
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
        // Tool 回應需要附加到前一個 assistant 訊息或創建新的 user 訊息
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
   * 轉換訊息內容
   */
  private convertMessageContent(msg: Message): AnthropicContent {
    // 簡單文字
    if (msg.content.content && !msg.content.multipleContent) {
      return msg.content.content;
    }

    // 多部分內容
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
          // 簡化圖片處理
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
   * 轉換 assistant 內容
   */
  private convertAssistantContent(msg: Message): AnthropicContent {
    const blocks: AnthropicContentBlock[] = [];

    // Thinking 內容
    if (msg.reasoningContent) {
      blocks.push({
        type: 'thinking',
        thinking: msg.reasoningContent,
        signature: msg.reasoningSignature || '',
      });
    }

    // 文字內容
    if (msg.content.content) {
      blocks.push({
        type: 'text',
        text: msg.content.content,
        cache_control: msg.cacheControl ? { type: msg.cacheControl.type } : undefined,
      });
    }

    // 多部分內容
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
   * Thinking 預算
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
   * 將 Anthropic 回應轉換為內部格式
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
   * 處理流式事件
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
          resp.choices = [{
            index: 0,
            delta: {
              role: 'assistant',
              content: {},
              toolCalls: [{
                id: event.content_block.id || '',
                type: 'function',
                function: { name: event.content_block.name || '', arguments: '' },
                index: this.streamState.toolIndex,
              }],
            },
          }];
        } else {
          return null;
        }
        break;

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          resp.choices = [{
            index: 0,
            delta: { role: 'assistant', content: { content: event.delta.text } },
          }];
        } else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
          resp.choices = [{
            index: 0,
            delta: {
              role: 'assistant',
              content: {},
              reasoningContent: event.delta.thinking,
            },
          }];
        } else if (event.delta?.type === 'signature_delta') {
          // Signature is part of thinking block — skip for internal format
          return null;
        } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json !== undefined) {
          const tc = this.streamState.toolCalls.get(this.streamState.toolIndex);
          if (tc) {
            resp.choices = [{
              index: 0,
              delta: {
                role: 'assistant',
                content: {},
                toolCalls: [{
                  id: tc.id,
                  type: 'function',
                  function: { name: '', arguments: event.delta.partial_json },
                  index: this.streamState.toolIndex,
                }],
              },
            }];
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
   * 轉換 stop_reason
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
   * 轉換 usage
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
