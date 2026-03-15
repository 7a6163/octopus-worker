/**
 * LLM-related type definitions
 * Corresponds to internal/transformer/model/model.go in the original Go project
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

  // Embedding API parameters (mutually exclusive with Messages)
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

  // Embedding API response (mutually exclusive with Choices)
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

// ==================== Embedding Types ====================

/**
 * Embedding input: supports a single string or string array
 */
export type EmbeddingInput = string | string[];

/**
 * Single embedding object in the embedding response
 */
export interface EmbeddingObject {
  object: 'embedding';
  index: number;
  embedding: number[] | string; // float array or base64 string
}
