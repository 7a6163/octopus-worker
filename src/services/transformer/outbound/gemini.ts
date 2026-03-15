/**
 * Gemini Outbound 轉換器
 * 將內部 LLM 格式轉換為 Google Gemini API 格式
 *
 * API 特性：
 * - 認證使用 query parameter (?key=)，不使用 header
 * - 端點格式：/models/{model}:generateContent 或 :streamGenerateContent
 * - system/developer 訊息放入 systemInstruction
 */

import type {
  InternalLLMRequest,
  InternalLLMResponse,
  Message,
  ToolCall,
  Usage,
} from '@/types/llm';
import type { OutboundTransformer } from '../interface';

// ==================== Gemini API 類型定義 ====================

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiContent;
  generationConfig?: GeminiGenerationConfig;
  tools?: GeminiToolDeclaration[];
  toolConfig?: { functionCallingConfig: GeminiFunctionCallingConfig };
  safetySettings?: Array<{ category: string; threshold: string }>;
}

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thought?: boolean;
}

interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  responseMimeType?: string;
  responseSchema?: unknown;
  thinkingConfig?: { thinkingBudget: number };
  responseModalities?: string[];
}

interface GeminiToolDeclaration {
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
}

interface GeminiFunctionCallingConfig {
  mode: string;
  allowedFunctionNames?: string[];
}

interface GeminiResponse {
  candidates: Array<{
    content: GeminiContent;
    finishReason?: string;
  }>;
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

// ==================== 常量 ====================

const REASONING_BUDGET: Record<string, number> = {
  low: 1024,
  medium: 4096,
  high: 24576,
};

const FINISH_REASON_MAP: Record<string, string> = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
  RECITATION: 'content_filter',
  OTHER: 'stop',
};

// ==================== 主要轉換器類別 ====================

export class GeminiOutbound implements OutboundTransformer {
  private streamId = '';
  private streamCreated = 0;

  async transformRequest(
    request: InternalLLMRequest,
    baseUrl: string,
    key: string
  ): Promise<Request> {
    const geminiReq = buildGeminiRequest(request);
    const modelName = normalizeModelName(request.model);

    // 構建 URL：/models/{model}:generateContent 或 :streamGenerateContent
    const cleanBase = baseUrl.replace(/\/$/, '');
    const method = request.stream ? 'streamGenerateContent' : 'generateContent';
    const streamParam = request.stream ? '?alt=sse' : '';
    const urlStr = `${cleanBase}/models/${modelName}:${method}${streamParam}`;

    return new Request(urlStr, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: request.stream ? 'text/event-stream' : 'application/json',
        'X-Goog-Api-Key': key,
      },
      body: JSON.stringify(geminiReq),
    });
  }

  async transformResponse(response: Response): Promise<InternalLLMResponse> {
    const text = await response.text();

    if (!text) {
      throw new Error('Response body is empty');
    }

    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const geminiResp = JSON.parse(text) as GeminiResponse;
    return convertGeminiResponse(geminiResp);
  }

  async transformStream(eventData: Uint8Array): Promise<InternalLLMResponse | null> {
    const text = new TextDecoder().decode(eventData).trim();

    if (!text) return null;

    if (text === '[DONE]') {
      return { object: '[DONE]', choices: [] };
    }

    try {
      const geminiResp = JSON.parse(text) as GeminiResponse;
      return this.convertStreamChunk(geminiResp);
    } catch (err) {
      console.warn('Failed to parse Gemini stream event:', text.slice(0, 100), err);
      return null;
    }
  }

  private convertStreamChunk(geminiResp: GeminiResponse): InternalLLMResponse | null {
    if (!this.streamId) {
      this.streamId = `chatcmpl-gemini-${Date.now()}`;
      this.streamCreated = Math.floor(Date.now() / 1000);
    }

    const candidate = geminiResp.candidates?.[0];
    if (!candidate) return null;

    const resp: InternalLLMResponse = {
      id: this.streamId,
      object: 'chat.completion.chunk',
      created: this.streamCreated,
      model: geminiResp.modelVersion,
      choices: [],
    };

    const delta: Message = { role: 'assistant', content: {} };
    const { textParts, reasoningParts, toolCalls, imageParts } = extractParts(candidate.content);

    if (reasoningParts.length > 0) {
      delta.reasoningContent = reasoningParts.join('');
    }

    if (textParts.length > 0) {
      delta.content = { content: textParts.join('') };
    }

    if (imageParts.length > 0) {
      delta.content = {
        multipleContent: imageParts.map((p) => ({
          type: 'image_url' as const,
          imageUrl: {
            url: `data:${p.mimeType};base64,${p.data}`,
          },
        })),
      };
    }

    if (toolCalls.length > 0) {
      delta.toolCalls = toolCalls;
    }

    resp.choices = [
      {
        index: 0,
        delta,
        finishReason: candidate.finishReason ? mapFinishReason(candidate.finishReason) : undefined,
      },
    ];

    if (geminiResp.usageMetadata) {
      resp.usage = convertUsage(geminiResp.usageMetadata);
    }

    return resp;
  }
}

// ==================== 請求構建 ====================

function buildGeminiRequest(req: InternalLLMRequest): GeminiRequest {
  const result: GeminiRequest = {
    contents: [],
  };

  // 分離 system 訊息與其他訊息
  const systemParts: GeminiPart[] = [];
  const contents: GeminiContent[] = [];

  for (const msg of req.messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      systemParts.push(...extractTextParts(msg));
    } else {
      const converted = convertMessage(msg);
      if (converted) {
        contents.push(converted);
      }
    }
  }

  if (systemParts.length > 0) {
    result.systemInstruction = { role: 'user', parts: systemParts };
  }

  result.contents = contents;

  // Generation config
  const genConfig = buildGenerationConfig(req);
  if (genConfig) {
    result.generationConfig = genConfig;
  }

  // Tools
  if (req.tools && req.tools.length > 0) {
    result.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }

  // Tool choice
  if (req.toolChoice) {
    const toolConfig = convertToolChoice(req.toolChoice);
    if (toolConfig) {
      result.toolConfig = { functionCallingConfig: toolConfig };
    }
  }

  return result;
}

function extractTextParts(msg: Message): GeminiPart[] {
  const parts: GeminiPart[] = [];

  if (msg.content.content) {
    parts.push({ text: msg.content.content });
  }

  if (msg.content.multipleContent) {
    for (const part of msg.content.multipleContent) {
      if (part.type === 'text' && part.text) {
        parts.push({ text: part.text });
      }
    }
  }

  return parts;
}

function convertMessage(msg: Message): GeminiContent | null {
  if (msg.role === 'tool') {
    return convertToolMessage(msg);
  }

  const role = msg.role === 'assistant' ? 'model' : 'user';
  const parts: GeminiPart[] = [];

  // Reasoning content
  if (msg.reasoningContent) {
    parts.push({ text: msg.reasoningContent, thought: true });
  }

  // Text content
  if (msg.content.content) {
    parts.push({ text: msg.content.content });
  }

  // Multiple content parts
  if (msg.content.multipleContent) {
    for (const part of msg.content.multipleContent) {
      if (part.type === 'text' && part.text) {
        parts.push({ text: part.text });
      } else if (part.type === 'image_url' && part.imageUrl) {
        const inlineData = parseImageUrl(part.imageUrl.url);
        if (inlineData) {
          parts.push({ inlineData });
        }
      }
    }
  }

  // Tool calls
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // Keep empty args on parse failure
      }
      parts.push({
        functionCall: { name: tc.function.name, args },
      });
    }
  }

  if (parts.length === 0) return null;

  return { role, parts };
}

function convertToolMessage(msg: Message): GeminiContent {
  let responseData: Record<string, unknown> = {};
  try {
    responseData = JSON.parse(msg.content.content || '{}');
  } catch {
    responseData = { result: msg.content.content || '' };
  }

  return {
    role: 'user',
    parts: [
      {
        functionResponse: {
          name: msg.toolCallId || 'unknown',
          response: responseData,
        },
      },
    ],
  };
}

function parseImageUrl(url: string): { mimeType: string; data: string } | null {
  // Handle data URLs: data:image/png;base64,<data>
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (match?.[1] && match[2]) {
    return { mimeType: match[1], data: match[2] };
  }
  return null;
}

// ==================== Generation Config ====================

function buildGenerationConfig(req: InternalLLMRequest): GeminiGenerationConfig | null {
  const config: GeminiGenerationConfig = {};
  let hasConfig = false;

  if (req.temperature !== undefined) {
    config.temperature = req.temperature;
    hasConfig = true;
  }

  if (req.topP !== undefined) {
    config.topP = req.topP;
    hasConfig = true;
  }

  const maxTokens = req.maxTokens ?? req.maxCompletionTokens;
  if (maxTokens !== undefined) {
    config.maxOutputTokens = maxTokens;
    hasConfig = true;
  }

  if (req.stop) {
    config.stopSequences = Array.isArray(req.stop) ? req.stop : [req.stop];
    hasConfig = true;
  }

  // Response format
  if (req.responseFormat) {
    const formatted = convertResponseFormat(req.responseFormat);
    if (formatted.responseMimeType) {
      config.responseMimeType = formatted.responseMimeType;
      hasConfig = true;
    }
    if (formatted.responseSchema) {
      config.responseSchema = formatted.responseSchema;
      hasConfig = true;
    }
  }

  // Reasoning / thinking
  if (req.reasoningEffort) {
    const budget = req.reasoningBudget ?? REASONING_BUDGET[req.reasoningEffort] ?? 4096;
    config.thinkingConfig = { thinkingBudget: budget };
    hasConfig = true;
  }

  // Modalities
  if (req.modalities && req.modalities.length > 0) {
    config.responseModalities = req.modalities.map(capitalize);
    hasConfig = true;
  }

  return hasConfig ? config : null;
}

function convertResponseFormat(format: {
  type: string;
  jsonSchema?: { schema: Record<string, unknown> };
}): { responseMimeType?: string; responseSchema?: unknown } {
  switch (format.type) {
    case 'json_object':
      return { responseMimeType: 'application/json' };
    case 'json_schema':
      return {
        responseMimeType: 'application/json',
        responseSchema: format.jsonSchema?.schema,
      };
    case 'text':
      return { responseMimeType: 'text/plain' };
    default:
      return {};
  }
}

function convertToolChoice(choice: {
  type: string;
  function?: { name: string };
}): GeminiFunctionCallingConfig | null {
  switch (choice.type) {
    case 'auto':
      return { mode: 'AUTO' };
    case 'required':
      return { mode: 'ANY' };
    case 'none':
      return { mode: 'NONE' };
    case 'function':
      return choice.function
        ? { mode: 'ANY', allowedFunctionNames: [choice.function.name] }
        : { mode: 'ANY' };
    default:
      return null;
  }
}

// ==================== 回應轉換 ====================

function convertGeminiResponse(geminiResp: GeminiResponse): InternalLLMResponse {
  const candidate = geminiResp.candidates?.[0];

  if (!candidate) {
    return {
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      choices: [{ index: 0, finishReason: 'stop' }],
    };
  }

  const { textParts, reasoningParts, toolCalls, imageParts } = extractParts(candidate.content);
  const message: Message = { role: 'assistant', content: {} };

  if (textParts.length > 0) {
    message.content = { content: textParts.join('') };
  }

  if (imageParts.length > 0) {
    const parts = imageParts.map((p) => ({
      type: 'image_url' as const,
      imageUrl: { url: `data:${p.mimeType};base64,${p.data}` },
    }));

    if (message.content.content) {
      message.content = {
        multipleContent: [{ type: 'text' as const, text: message.content.content }, ...parts],
      };
    } else {
      message.content = { multipleContent: parts };
    }
  }

  if (reasoningParts.length > 0) {
    message.reasoningContent = reasoningParts.join('');
  }

  if (toolCalls.length > 0) {
    message.toolCalls = toolCalls;
  }

  return {
    id: `chatcmpl-gemini-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: geminiResp.modelVersion,
    choices: [
      {
        index: 0,
        message,
        finishReason: candidate.finishReason ? mapFinishReason(candidate.finishReason) : 'stop',
      },
    ],
    usage: geminiResp.usageMetadata ? convertUsage(geminiResp.usageMetadata) : undefined,
  };
}

interface ExtractedParts {
  textParts: string[];
  reasoningParts: string[];
  toolCalls: ToolCall[];
  imageParts: Array<{ mimeType: string; data: string }>;
}

function extractParts(content: GeminiContent | undefined): ExtractedParts {
  const result: ExtractedParts = {
    textParts: [],
    reasoningParts: [],
    toolCalls: [],
    imageParts: [],
  };

  if (!content?.parts) return result;

  for (let i = 0; i < content.parts.length; i++) {
    const part = content.parts[i]!;

    if (part.thought && part.text) {
      result.reasoningParts.push(part.text);
    } else if (part.text !== undefined && !part.thought) {
      result.textParts.push(part.text);
    }

    if (part.functionCall) {
      result.toolCalls.push({
        id: `call_${part.functionCall.name}_${i}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }

    if (part.inlineData) {
      result.imageParts.push({
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
      });
    }
  }

  return result;
}

// ==================== 工具函數 ====================

function normalizeModelName(model: string): string {
  return model.startsWith('models/') ? model.slice(7) : model;
}

function mapFinishReason(reason: string): string {
  return FINISH_REASON_MAP[reason] || reason.toLowerCase();
}

function convertUsage(meta: GeminiUsageMetadata): Usage {
  return {
    promptTokens: meta.promptTokenCount || 0,
    completionTokens: meta.candidatesTokenCount || 0,
    totalTokens: meta.totalTokenCount || 0,
    promptTokensDetails: meta.cachedContentTokenCount
      ? { cachedTokens: meta.cachedContentTokenCount }
      : undefined,
    completionTokensDetails: meta.thoughtsTokenCount
      ? { reasoningTokens: meta.thoughtsTokenCount }
      : undefined,
  };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
