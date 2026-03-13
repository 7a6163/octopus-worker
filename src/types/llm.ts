/**
 * LLM 相關類型定義
 * 對應原始 Go 專案的 internal/transformer/model/model.go
 */

export interface InternalLLMRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  streamOptions?: StreamOptions;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  maxCompletionTokens?: number;
  tools?: Tool[];
  toolChoice?: ToolChoice;
  stop?: Stop;
  responseFormat?: ResponseFormat;
  reasoningEffort?: string;
  reasoningBudget?: number;
  metadata?: Record<string, string>;
  modalities?: string[];
  query?: URLSearchParams;
  transformerMetadata?: Record<string, string>;
  user?: string;
  rawAPIFormat?: string;

  // Embedding API 參數（與 Messages 互斥）
  embeddingInput?: EmbeddingInput;
  embeddingDimensions?: number;
  embeddingEncodingFormat?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content: MessageContent;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolCallIsError?: boolean;
  cacheControl?: CacheControl;
  reasoningContent?: string;
  reasoningSignature?: string;
  messageIndex?: number;
}

export interface MessageContent {
  content?: string;
  multipleContent?: MessageContentPart[];
}

export interface MessageContentPart {
  type: 'text' | 'image_url' | 'input_audio' | 'file';
  text?: string;
  imageUrl?: ImageUrl;
  audio?: Audio;
  file?: File;
  cacheControl?: CacheControl;
}

export interface ImageUrl {
  url: string;
  detail?: 'auto' | 'low' | 'high';
}

export interface Audio {
  data: string;
  format: string;
}

export interface File {
  fileData: string;
}

export interface CacheControl {
  type: 'ephemeral';
  ttl?: number;
}

export interface StreamOptions {
  includeUsage?: boolean;
}

export interface Tool {
  type: 'function';
  function: ToolFunction;
  cacheControl?: CacheControl;
}

export interface ToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ToolChoice {
  type: 'auto' | 'none' | 'required' | 'function';
  function?: { name: string };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  index?: number;
  cacheControl?: CacheControl;
}

export type Stop = string | string[];

export interface ResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  jsonSchema?: {
    name: string;
    description?: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface InternalLLMResponse {
  id?: string;
  object: string;
  created?: number;
  model?: string;
  choices: Choice[];
  usage?: Usage;
  error?: ErrorDetail;

  // Embedding API 回應（與 Choices 互斥）
  embeddingData?: EmbeddingObject[];
}

export interface Choice {
  index: number;
  message?: Message;
  delta?: Message;
  finishReason?: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  promptTokensDetails?: PromptTokensDetails;
  completionTokensDetails?: CompletionTokensDetails;
  anthropicUsage?: boolean;
}

export interface PromptTokensDetails {
  cachedTokens?: number;
  audioTokens?: number;
}

export interface CompletionTokensDetails {
  reasoningTokens?: number;
  audioTokens?: number;
}

export interface ErrorDetail {
  message: string;
  type?: string;
  param?: string;
  code?: string;
}

// ==================== Embedding 類型 ====================

/**
 * Embedding 輸入：支援單一字串或字串陣列
 */
export type EmbeddingInput = string | string[];

/**
 * Embedding 回應中的單個 embedding 物件
 */
export interface EmbeddingObject {
  object: 'embedding';
  index: number;
  embedding: number[] | string; // float array 或 base64 string
}
