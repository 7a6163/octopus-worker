/**
 * OpenAI Responses API inbound transformer
 * Corresponds to internal/transformer/inbound/openai/response.go in the original Go project
 *
 * Responsibilities:
 * - Convert client Responses API requests to internal Chat Completions format
 * - Convert internal Chat Completions responses/streams back to Responses API format for the client
 */

import type {
  InternalLLMRequest,
  InternalLLMResponse,
  Message,
  ToolCall,
  Usage,
} from '@/types/llm';
import type { InboundTransformer } from '../interface';

// ==================== Responses API types (client format) ====================

interface ResponsesAPIRequest {
  model: string;
  instructions?: string;
  input: string | ResponsesItem[];
  tools?: ResponsesTool[];
  tool_choice?: string | { type: string; name: string };
  parallel_tool_calls?: boolean;
  stream?: boolean;
  text?: { format?: { type: string } };
  store?: boolean;
  service_tier?: string;
  user?: string;
  metadata?: Record<string, string>;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  reasoning?: { effort?: string; max_tokens?: number };
  include?: string[];
}

interface ResponsesItem {
  id?: string;
  type?: string;
  role?: string;
  content?: string | ResponsesItem[];
  status?: string;
  text?: string;
  image_url?: string;
  detail?: string;
  annotations?: ResponsesAnnotation[];
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string | ResponsesItem[];
  summary?: Array<{ type: string; text: string }>;
  encrypted_content?: string;
}

interface ResponsesAnnotation {
  type: string;
  start_index?: number;
  end_index?: number;
  url?: string;
  title?: string;
}

interface ResponsesTool {
  type: string;
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

interface ResponsesResponse {
  object: string;
  id: string;
  model: string;
  created_at: number;
  output: ResponsesItem[];
  status?: string;
  usage?: ResponsesUsage;
}

interface ResponsesUsage {
  input_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number };
  total_tokens: number;
}

interface ResponsesStreamEvent {
  type: string;
  sequence_number: number;
  response?: ResponsesResponse;
  output_index?: number;
  item?: ResponsesItem;
  item_id?: string;
  content_index?: number;
  delta?: string;
  text?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  summary_index?: number;
  part?: { type: string; text?: string; annotations?: ResponsesAnnotation[] };
}

// ==================== Inbound transformer ====================

export class OpenAIResponseInbound implements InboundTransformer {
  private lastResponse: InternalLLMResponse | null = null;

  // Streaming state
  private hasResponseCreated = false;
  private hasMessageItemStarted = false;
  private hasReasoningItemStarted = false;
  private hasContentPartStarted = false;
  private hasFinished = false;
  private responseCompleted = false;

  private responseId = '';
  private model = '';
  private createdAt = 0;
  private outputIndex = 0;
  private contentIndex = 0;
  private sequenceNumber = 0;
  private currentItemId = '';

  private accumulatedText = '';
  private accumulatedReasoning = '';
  private usage: Usage | undefined;

  // Tool call tracking
  private toolCalls = new Map<number, ToolCall>();
  private toolCallItemStarted = new Map<number, boolean>();
  private toolCallOutputIndex = new Map<number, number>();

  async transformRequest(body: ArrayBuffer): Promise<InternalLLMRequest> {
    const text = new TextDecoder().decode(body);
    if (!text) throw new Error('Request body is empty');

    let req: ResponsesAPIRequest;
    try {
      req = JSON.parse(text) as ResponsesAPIRequest;
    } catch {
      throw new Error('Invalid JSON');
    }

    if (!req.model) throw new Error('model is required');

    const messages: Message[] = [];

    // Instructions → system message
    if (req.instructions) {
      messages.push({ role: 'system', content: { content: req.instructions } });
    }

    // Input → user/assistant/tool messages
    if (typeof req.input === 'string') {
      messages.push({ role: 'user', content: { content: req.input } });
    } else if (Array.isArray(req.input)) {
      for (const item of req.input) {
        const msg = convertItemToMessage(item);
        if (msg) messages.push(msg);
      }
    }

    const result: InternalLLMRequest = {
      model: req.model,
      messages,
      stream: req.stream,
      temperature: req.temperature,
      topP: req.top_p,
      maxCompletionTokens: req.max_output_tokens,
      user: req.user,
      metadata: req.metadata,
      rawAPIFormat: 'openai/responses',
    };

    // Tools
    if (req.tools && req.tools.length > 0) {
      result.tools = req.tools
        .filter((t) => t.type === 'function')
        .map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name || '',
            description: t.description,
            parameters: t.parameters,
          },
        }));
    }

    // Tool choice
    if (req.tool_choice) {
      if (typeof req.tool_choice === 'string') {
        result.toolChoice = { type: req.tool_choice as 'auto' | 'none' | 'required' };
      } else {
        result.toolChoice = {
          type: 'function',
          function: { name: req.tool_choice.name },
        };
      }
    }

    // Response format
    if (req.text?.format) {
      result.responseFormat = {
        type: req.text.format.type as 'text' | 'json_object' | 'json_schema',
      };
    }

    // Reasoning
    if (req.reasoning?.effort) {
      result.reasoningEffort = req.reasoning.effort;
    }
    if (req.reasoning?.max_tokens) {
      result.reasoningBudget = req.reasoning.max_tokens;
    }

    return result;
  }

  async transformResponse(response: InternalLLMResponse): Promise<Uint8Array> {
    this.lastResponse = response;

    const resp = convertToResponsesAPIResponse(response);
    return new TextEncoder().encode(JSON.stringify(resp));
  }

  async transformStream(stream: InternalLLMResponse): Promise<Uint8Array | null> {
    if (stream.object === '[DONE]') {
      return new TextEncoder().encode('data: [DONE]\n\n');
    }

    this.lastResponse = stream;

    const events: string[] = [];

    // Update metadata
    if (!this.responseId && stream.id) this.responseId = stream.id;
    if (!this.model && stream.model) this.model = stream.model;
    if (!this.createdAt && stream.created) this.createdAt = stream.created;
    if (stream.usage) this.usage = stream.usage;

    // response.created + response.in_progress
    if (!this.hasResponseCreated) {
      this.hasResponseCreated = true;
      const response: ResponsesResponse = {
        object: 'response',
        id: this.responseId,
        model: this.model,
        created_at: this.createdAt,
        status: 'in_progress',
        output: [],
      };

      events.push(this.formatEvent({ type: 'response.created', response }));
      events.push(this.formatEvent({ type: 'response.in_progress', response }));
    }

    // Process choices
    if (stream.choices.length > 0) {
      const choice = stream.choices[0];
      if (!choice) return null;

      // Reasoning content
      if (choice.delta?.reasoningContent) {
        events.push(...this.handleReasoningContent(choice.delta.reasoningContent));
      }

      // Text content
      if (choice.delta?.content?.content) {
        events.push(...this.handleTextContent(choice.delta.content.content));
      }

      // Tool calls
      if (choice.delta?.toolCalls && choice.delta.toolCalls.length > 0) {
        events.push(...this.handleToolCalls(choice.delta.toolCalls));
      }

      // Finish
      if (choice.finishReason && !this.hasFinished) {
        this.hasFinished = true;
        events.push(...this.closeCurrentContentPart());
        events.push(...this.closeCurrentOutputItem());
      }
    }

    // Final usage chunk
    if (stream.usage && this.hasFinished && !this.responseCompleted) {
      this.responseCompleted = true;
      this.usage = stream.usage;

      const response: ResponsesResponse = {
        object: 'response',
        id: this.responseId,
        model: this.model,
        created_at: this.createdAt,
        status: 'completed',
        output: [],
        usage: convertUsageToResponses(this.usage),
      };

      events.push(this.formatEvent({ type: 'response.completed', response }));
    }

    if (events.length === 0) return null;

    return new TextEncoder().encode(events.join(''));
  }

  getInternalResponse(): InternalLLMResponse | null {
    return this.lastResponse;
  }

  // ==================== Stream helper methods ====================

  private formatEvent(event: Partial<ResponsesStreamEvent> & { type: string }): string {
    const ev: ResponsesStreamEvent = {
      ...event,
      sequence_number: this.sequenceNumber++,
    } as ResponsesStreamEvent;
    return `data: ${JSON.stringify(ev)}\n\n`;
  }

  private handleReasoningContent(content: string): string[] {
    const events: string[] = [];

    if (!this.hasReasoningItemStarted) {
      events.push(...this.closeCurrentOutputItem());
      this.hasReasoningItemStarted = true;
      this.currentItemId = generateItemId();

      events.push(
        this.formatEvent({
          type: 'response.output_item.added',
          output_index: this.outputIndex,
          item: { id: this.currentItemId, type: 'reasoning', status: 'in_progress', summary: [] },
        })
      );

      events.push(
        this.formatEvent({
          type: 'response.reasoning_summary_part.added',
          item_id: this.currentItemId,
          output_index: this.outputIndex,
          summary_index: 0,
          part: { type: 'summary_text' },
        })
      );
    }

    this.accumulatedReasoning += content;

    events.push(
      this.formatEvent({
        type: 'response.reasoning_summary_text.delta',
        item_id: this.currentItemId,
        output_index: this.outputIndex,
        summary_index: 0,
        delta: content,
      })
    );

    return events;
  }

  private handleTextContent(content: string): string[] {
    const events: string[] = [];

    if (this.hasReasoningItemStarted) {
      events.push(...this.closeReasoningItem());
    }

    if (!this.hasMessageItemStarted) {
      this.hasMessageItemStarted = true;
      this.currentItemId = generateItemId();

      events.push(
        this.formatEvent({
          type: 'response.output_item.added',
          output_index: this.outputIndex,
          item: {
            id: this.currentItemId,
            type: 'message',
            status: 'in_progress',
            role: 'assistant',
            content: [],
          },
        })
      );
    }

    if (!this.hasContentPartStarted) {
      this.hasContentPartStarted = true;

      events.push(
        this.formatEvent({
          type: 'response.content_part.added',
          item_id: this.currentItemId,
          output_index: this.outputIndex,
          content_index: this.contentIndex,
          part: { type: 'output_text', text: '' },
        })
      );
    }

    this.accumulatedText += content;

    events.push(
      this.formatEvent({
        type: 'response.output_text.delta',
        item_id: this.currentItemId,
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        delta: content,
      })
    );

    return events;
  }

  private handleToolCalls(toolCalls: ToolCall[]): string[] {
    const events: string[] = [];

    if (this.hasMessageItemStarted) {
      events.push(...this.closeMessageItem());
    }
    if (this.hasReasoningItemStarted) {
      events.push(...this.closeReasoningItem());
    }

    for (const tc of toolCalls) {
      const idx = tc.index ?? 0;

      if (!this.toolCalls.has(idx)) {
        events.push(...this.closeCurrentContentPart());
        events.push(...this.closeCurrentOutputItem());

        this.toolCalls.set(idx, {
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: '' },
          index: idx,
        });

        const itemId = tc.id || generateItemId();
        events.push(
          this.formatEvent({
            type: 'response.output_item.added',
            output_index: this.outputIndex,
            item: {
              id: itemId,
              type: 'function_call',
              status: 'in_progress',
              call_id: tc.id,
              name: tc.function.name,
            },
          })
        );

        this.toolCallItemStarted.set(idx, true);
        this.toolCallOutputIndex.set(idx, this.outputIndex);
        this.currentItemId = itemId;
        this.outputIndex++;
      }

      const stored = this.toolCalls.get(idx)!;
      stored.function.arguments += tc.function.arguments;

      if (tc.function.arguments) {
        const itemId = stored.id || this.currentItemId;
        events.push(
          this.formatEvent({
            type: 'response.function_call_arguments.delta',
            item_id: itemId,
            output_index: this.outputIndex - 1,
            content_index: 0,
            delta: tc.function.arguments,
          })
        );
      }
    }

    return events;
  }

  private closeReasoningItem(): string[] {
    if (!this.hasReasoningItemStarted) return [];
    this.hasReasoningItemStarted = false;
    const events: string[] = [];
    const fullText = this.accumulatedReasoning;

    events.push(
      this.formatEvent({
        type: 'response.reasoning_summary_text.done',
        item_id: this.currentItemId,
        output_index: this.outputIndex,
        summary_index: 0,
        text: fullText,
      })
    );

    events.push(
      this.formatEvent({
        type: 'response.reasoning_summary_part.done',
        item_id: this.currentItemId,
        output_index: this.outputIndex,
        summary_index: 0,
        part: { type: 'summary_text', text: fullText },
      })
    );

    events.push(
      this.formatEvent({
        type: 'response.output_item.done',
        output_index: this.outputIndex,
        item: {
          id: this.currentItemId,
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: fullText }],
        },
      })
    );

    this.outputIndex++;
    this.accumulatedReasoning = '';
    return events;
  }

  private closeMessageItem(): string[] {
    if (!this.hasMessageItemStarted) return [];
    this.hasMessageItemStarted = false;
    const events: string[] = [];
    const fullText = this.accumulatedText;

    events.push(...this.closeCurrentContentPart());

    events.push(
      this.formatEvent({
        type: 'response.output_item.done',
        output_index: this.outputIndex,
        item: {
          id: this.currentItemId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: fullText }] as unknown as string,
        },
      })
    );

    this.outputIndex++;
    this.contentIndex = 0;
    this.accumulatedText = '';
    return events;
  }

  private closeCurrentContentPart(): string[] {
    if (!this.hasContentPartStarted) return [];
    this.hasContentPartStarted = false;
    const events: string[] = [];
    const fullText = this.accumulatedText;

    events.push(
      this.formatEvent({
        type: 'response.output_text.done',
        item_id: this.currentItemId,
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        text: fullText,
      })
    );

    events.push(
      this.formatEvent({
        type: 'response.content_part.done',
        item_id: this.currentItemId,
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        part: { type: 'output_text', text: fullText },
      })
    );

    return events;
  }

  private closeCurrentOutputItem(): string[] {
    const events: string[] = [];

    if (this.hasMessageItemStarted) {
      events.push(...this.closeMessageItem());
    }
    if (this.hasReasoningItemStarted) {
      events.push(...this.closeReasoningItem());
    }

    // Close tool call items
    for (const [idx, tc] of this.toolCalls) {
      if (this.toolCallItemStarted.get(idx)) {
        const itemId = tc.id || this.currentItemId;
        const toolOutputIdx = this.toolCallOutputIndex.get(idx) ?? 0;

        events.push(
          this.formatEvent({
            type: 'response.function_call_arguments.done',
            item_id: itemId,
            output_index: toolOutputIdx,
            arguments: tc.function.arguments,
          })
        );

        events.push(
          this.formatEvent({
            type: 'response.output_item.done',
            output_index: toolOutputIdx,
            item: {
              id: itemId,
              type: 'function_call',
              status: 'completed',
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })
        );

        this.toolCallItemStarted.set(idx, false);
      }
    }

    return events;
  }
}

// ==================== Helper functions ====================

function convertItemToMessage(item: ResponsesItem): Message | null {
  switch (item.type) {
    case 'message':
    case 'input_text':
    case undefined: {
      const msg: Message = { role: (item.role as Message['role']) || 'user', content: {} };
      if (typeof item.content === 'string') {
        msg.content = { content: item.content };
      } else if (Array.isArray(item.content)) {
        const textParts = item.content
          .filter(
            (ci) =>
              (ci.type === 'output_text' || ci.type === 'input_text' || ci.type === 'text') &&
              ci.text
          )
          .map((ci) => ci.text || '');
        if (textParts.length > 0) {
          msg.content = { content: textParts.join('') };
        }
      } else if (item.text) {
        msg.content = { content: item.text };
      }
      return msg;
    }

    case 'input_image':
      if (item.image_url) {
        return {
          role: (item.role as Message['role']) || 'user',
          content: {
            multipleContent: [
              {
                type: 'image_url',
                imageUrl: {
                  url: item.image_url,
                  detail: item.detail as 'auto' | 'low' | 'high' | undefined,
                },
              },
            ],
          },
        };
      }
      return null;

    case 'function_call':
      return {
        role: 'assistant',
        content: {},
        toolCalls: [
          {
            id: item.call_id || '',
            type: 'function',
            function: { name: item.name || '', arguments: item.arguments || '' },
          },
        ],
      };

    case 'function_call_output': {
      const outputText = typeof item.output === 'string' ? item.output : '';
      return {
        role: 'tool',
        content: { content: outputText },
        toolCallId: item.call_id,
      };
    }

    case 'reasoning': {
      const reasoningText = item.summary?.map((s) => s.text).join('') || '';
      const msg: Message = { role: 'assistant', content: {} };
      if (reasoningText) msg.reasoningContent = reasoningText;
      if (item.encrypted_content) msg.reasoningSignature = item.encrypted_content;
      return msg;
    }

    default:
      return null;
  }
}

function convertToResponsesAPIResponse(resp: InternalLLMResponse): ResponsesResponse {
  const result: ResponsesResponse = {
    object: 'response',
    id: resp.id || '',
    model: resp.model || '',
    created_at: resp.created || Math.floor(Date.now() / 1000),
    output: [],
    status: 'completed',
  };

  result.usage = resp.usage ? convertUsageToResponses(resp.usage) : undefined;

  for (const choice of resp.choices) {
    const message = choice.message || choice.delta;
    if (!message) continue;

    // Reasoning
    if (message.reasoningContent) {
      result.output.push({
        id: generateItemId(),
        type: 'reasoning',
        status: 'completed',
        summary: [{ type: 'summary_text', text: message.reasoningContent }],
      });
    }

    // Tool calls
    if (message.toolCalls) {
      for (const tc of message.toolCalls) {
        result.output.push({
          id: tc.id,
          type: 'function_call',
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          status: 'completed',
        });
      }
    }

    // Text content
    if (message.content.content) {
      result.output.push({
        id: generateItemId(),
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          { type: 'output_text', text: message.content.content, annotations: [] },
        ] as unknown as string,
      });
    }

    // Finish reason → status
    if (choice.finishReason === 'stop') result.status = 'completed';
    else if (choice.finishReason === 'length') result.status = 'incomplete';
    else if (choice.finishReason === 'error') result.status = 'failed';
  }

  if (result.output.length === 0) {
    result.output = [
      {
        id: generateItemId(),
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '' }] as unknown as string,
      },
    ];
  }

  return result;
}

function convertUsageToResponses(usage: Usage): ResponsesUsage {
  return {
    input_tokens: usage.promptTokens,
    input_tokens_details: {
      cached_tokens: usage.promptTokensDetails?.cachedTokens || 0,
    },
    output_tokens: usage.completionTokens,
    output_tokens_details: {
      reasoning_tokens: usage.completionTokensDetails?.reasoningTokens || 0,
    },
    total_tokens: usage.totalTokens,
  };
}

function generateItemId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'item_';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
