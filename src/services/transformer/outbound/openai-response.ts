/**
 * OpenAI Responses API outbound transformer
 * Corresponds to internal/transformer/outbound/openai/response.go in the original Go project
 *
 * Responsibilities:
 * - Convert internal Chat Completions requests to Responses API format for upstream
 * - Convert upstream Responses API responses/streams back to internal Chat Completions format
 */

import type {
  InternalLLMRequest,
  InternalLLMResponse,
  Message,
  MessageContentPart,
  ToolCall,
  Usage,
} from '@/types/llm';
import type { OutboundTransformer } from '../interface';

// ==================== Responses API types ====================

interface ResponsesRequest {
  model: string;
  instructions?: string;
  input: ResponsesInput;
  tools?: ResponsesTool[];
  tool_choice?: ResponsesToolChoice;
  parallel_tool_calls?: boolean;
  stream?: boolean;
  text?: ResponsesTextOptions;
  store?: boolean;
  service_tier?: string;
  user?: string;
  metadata?: Record<string, string>;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  reasoning?: { effort?: string };
}

type ResponsesInput = string | ResponsesItem[];

interface ResponsesItem {
  id?: string;
  type?: string;
  role?: string;
  content?: ResponsesInput;
  status?: string;
  text?: string;
  image_url?: string;
  detail?: string;
  annotations?: ResponsesAnnotation[];
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: ResponsesInput;
  result?: string;
  background?: string;
  output_format?: string;
  quality?: string;
  size?: string;
  summary?: Array<{ type: string; text: string }>;
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

type ResponsesToolChoice = string | { type: string; name: string };

interface ResponsesTextOptions {
  format?: { type: string; name?: string; schema?: unknown };
}

interface ResponsesResponse {
  object: string;
  id: string;
  model: string;
  created_at: number;
  output: ResponsesItem[];
  status?: string;
  usage?: ResponsesUsage;
  error?: { code: number; message: string };
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
}

// ==================== Outbound transformer ====================

export class OpenAIResponseOutbound implements OutboundTransformer {
  private streamId = '';
  private streamModel = '';

  async transformRequest(
    request: InternalLLMRequest,
    baseUrl: string,
    key: string
  ): Promise<Request> {
    const responsesReq = convertToResponsesRequest(request);

    const url = new URL(baseUrl.replace(/\/$/, ''));
    url.pathname = `${url.pathname}/responses`;

    return new Request(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(responsesReq),
    });
  }

  async transformResponse(response: Response): Promise<InternalLLMResponse> {
    const text = await response.text();
    if (!text) {
      throw new Error('Response body is empty');
    }

    const resp = JSON.parse(text) as ResponsesResponse;
    return convertToInternalResponse(resp);
  }

  async transformStream(eventData: Uint8Array): Promise<InternalLLMResponse | null> {
    const text = new TextDecoder().decode(eventData).trim();
    if (!text) return null;

    if (text === '[DONE]') {
      return { object: '[DONE]', choices: [] };
    }

    let event: ResponsesStreamEvent;
    try {
      event = JSON.parse(text) as ResponsesStreamEvent;
    } catch {
      return null;
    }

    const resp: InternalLLMResponse = {
      id: this.streamId,
      model: this.streamModel,
      object: 'chat.completion.chunk',
      choices: [],
    };

    switch (event.type) {
      case 'response.created':
      case 'response.in_progress':
        if (event.response) {
          this.streamId = event.response.id;
          this.streamModel = event.response.model;
          resp.id = this.streamId;
          resp.model = this.streamModel;
        }
        resp.choices = [{ index: 0, delta: { role: 'assistant', content: { content: '' } } }];
        break;

      case 'response.output_text.delta':
        resp.choices = [
          {
            index: 0,
            delta: { role: 'assistant', content: { content: event.delta || '' } },
          },
        ];
        break;

      case 'response.function_call_arguments.delta':
        resp.choices = [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: {},
              toolCalls: [
                {
                  id: event.call_id || '',
                  type: 'function',
                  function: { name: event.name || '', arguments: event.delta || '' },
                  index: event.output_index,
                },
              ],
            },
          },
        ];
        break;

      case 'response.output_item.added':
        if (event.item?.type === 'function_call') {
          resp.choices = [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: {},
                toolCalls: [
                  {
                    id: event.item.call_id || '',
                    type: 'function',
                    function: { name: event.item.name || '', arguments: '' },
                    index: event.output_index,
                  },
                ],
              },
            },
          ];
        } else {
          return null;
        }
        break;

      case 'response.reasoning_summary_text.delta':
        resp.choices = [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: {},
              reasoningContent: event.delta || '',
            },
          },
        ];
        break;

      case 'response.completed':
        if (event.response) {
          let finishReason: string | undefined;
          if (event.response.status === 'completed') finishReason = 'stop';
          else if (event.response.status === 'incomplete') finishReason = 'length';
          else if (event.response.status === 'failed') finishReason = 'error';

          resp.choices = [{ index: 0, finishReason }];

          if (event.response.usage) {
            resp.usage = convertResponsesUsage(event.response.usage);
          }
        }
        break;

      case 'response.failed':
      case 'response.incomplete':
      case 'error':
        resp.choices = [{ index: 0, finishReason: 'error' }];
        break;

      default:
        return null;
    }

    return resp;
  }
}

// ==================== Request conversion ====================

function convertToResponsesRequest(req: InternalLLMRequest): ResponsesRequest {
  const result: ResponsesRequest = {
    model: req.model,
    input: [],
    temperature: req.temperature,
    top_p: req.topP,
    stream: req.stream,
    user: req.user,
    metadata: req.metadata,
    max_output_tokens: req.maxCompletionTokens,
  };

  // Instructions from system messages
  const instructions = req.messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => m.content.content || '')
    .filter(Boolean)
    .join('\n');
  if (instructions) {
    result.instructions = instructions;
  }

  // Input from non-system messages
  const nonSystemMsgs = req.messages.filter((m) => m.role !== 'system' && m.role !== 'developer');

  if (
    nonSystemMsgs.length === 1 &&
    nonSystemMsgs[0]?.content.content &&
    nonSystemMsgs[0].role === 'user'
  ) {
    result.input = nonSystemMsgs[0].content.content;
  } else {
    result.input = nonSystemMsgs.flatMap((msg) => convertMessageToResponsesItems(msg));
  }

  // Tools
  if (req.tools && req.tools.length > 0) {
    result.tools = req.tools.map((t) => ({
      type: t.type,
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
  }

  // Tool choice
  if (req.toolChoice) {
    if (req.toolChoice.type === 'function' && req.toolChoice.function) {
      result.tool_choice = { type: 'function', name: req.toolChoice.function.name };
    } else {
      result.tool_choice = req.toolChoice.type;
    }
  }

  // Response format
  if (req.responseFormat) {
    result.text = { format: { type: req.responseFormat.type } };
  }

  // Reasoning
  if (req.reasoningEffort) {
    result.reasoning = { effort: req.reasoningEffort };
  }

  return result;
}

function convertMessageToResponsesItems(msg: Message): ResponsesItem[] {
  switch (msg.role) {
    case 'user': {
      const items: ResponsesItem[] = [];
      if (msg.content.content) {
        items.push({ type: 'input_text', text: msg.content.content });
      }
      if (msg.content.multipleContent) {
        for (const part of msg.content.multipleContent) {
          if (part.type === 'text' && part.text) {
            items.push({ type: 'input_text', text: part.text });
          } else if (part.type === 'image_url' && part.imageUrl) {
            items.push({
              type: 'input_image',
              image_url: part.imageUrl.url,
              detail: part.imageUrl.detail,
            });
          }
        }
      }
      return [{ role: 'user', content: items as unknown as ResponsesInput }];
    }

    case 'assistant': {
      const result: ResponsesItem[] = [];
      // Tool calls
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          result.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
      }
      // Content
      if (msg.content.content) {
        result.push({
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            { type: 'output_text', text: msg.content.content },
          ] as unknown as ResponsesInput,
        });
      }
      return result;
    }

    case 'tool':
      return [
        {
          type: 'function_call_output',
          call_id: msg.toolCallId || '',
          output: (msg.content.content || '') as unknown as ResponsesInput,
        },
      ];

    default:
      return [];
  }
}

// ==================== Response conversion ====================

function convertToInternalResponse(resp: ResponsesResponse): InternalLLMResponse {
  const result: InternalLLMResponse = {
    id: resp.id,
    object: 'chat.completion',
    model: resp.model,
    created: resp.created_at,
    choices: [],
  };

  let textContent = '';
  let reasoningContent = '';
  const toolCalls: ToolCall[] = [];
  const contentParts: MessageContentPart[] = [];

  for (const item of resp.output) {
    switch (item.type) {
      case 'message':
        if (Array.isArray(item.content)) {
          for (const ci of item.content as unknown as ResponsesItem[]) {
            if (ci.type === 'output_text' && ci.text) {
              textContent += ci.text;
            }
          }
        }
        break;

      case 'output_text':
        if (item.text) textContent += item.text;
        break;

      case 'function_call':
        toolCalls.push({
          id: item.call_id || '',
          type: 'function',
          function: { name: item.name || '', arguments: item.arguments || '' },
        });
        break;

      case 'reasoning':
        if (item.summary) {
          for (const s of item.summary) {
            reasoningContent += s.text;
          }
        }
        break;
    }
  }

  const message: Message = {
    role: 'assistant',
    content: {},
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };

  if (reasoningContent) {
    message.reasoningContent = reasoningContent;
  }

  if (textContent) {
    if (contentParts.length > 0) {
      contentParts.unshift({ type: 'text', text: textContent });
      message.content = { multipleContent: contentParts };
    } else {
      message.content = { content: textContent };
    }
  } else if (contentParts.length > 0) {
    message.content = { multipleContent: contentParts };
  }

  // Finish reason
  let finishReason: string | undefined;
  if (toolCalls.length > 0) {
    finishReason = 'tool_calls';
  } else if (resp.status === 'completed') {
    finishReason = 'stop';
  } else if (resp.status === 'failed') {
    finishReason = 'error';
  } else if (resp.status === 'incomplete') {
    finishReason = 'length';
  }

  result.choices = [{ index: 0, message, finishReason }];
  result.usage = resp.usage ? convertResponsesUsage(resp.usage) : undefined;

  return result;
}

function convertResponsesUsage(usage: ResponsesUsage): Usage {
  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    promptTokensDetails: usage.input_tokens_details?.cached_tokens
      ? { cachedTokens: usage.input_tokens_details.cached_tokens }
      : undefined,
    completionTokensDetails: usage.output_tokens_details?.reasoning_tokens
      ? { reasoningTokens: usage.output_tokens_details.reasoning_tokens }
      : undefined,
  };
}
