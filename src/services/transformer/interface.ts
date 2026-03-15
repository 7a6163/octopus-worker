/**
 * Protocol transformer interfaces
 * Corresponds to internal/transformer/model/interface.go in the original Go project
 */

import type { InternalLLMRequest, InternalLLMResponse } from '@/types/llm';

/**
 * Inbound transformer interface
 * Converts client requests to internal format and internal responses back to client format
 */
export interface InboundTransformer {
  /**
   * Convert client request body to internal LLM request format
   * @param body Client request as ArrayBuffer
   * @returns Internal LLM request object
   */
  transformRequest(body: ArrayBuffer): Promise<InternalLLMRequest>;

  /**
   * Convert internal response format to client format
   * @param response Internal LLM response object
   * @returns Client-format response as Uint8Array
   */
  transformResponse(response: InternalLLMResponse): Promise<Uint8Array>;

  /**
   * Convert internal streaming response to client format
   * @param stream Internal streaming response object
   * @returns Client-format SSE event as Uint8Array, or null if skipped
   */
  transformStream(stream: InternalLLMResponse): Promise<Uint8Array | null>;

  /**
   * Get the last processed internal response (used for statistics)
   * @returns Internal response object or null
   */
  getInternalResponse(): InternalLLMResponse | null;
}

/**
 * Outbound transformer interface
 * Converts internal format to upstream API format and upstream responses back to internal format
 */
export interface OutboundTransformer {
  /**
   * Convert internal request to upstream API request
   * @param request Internal LLM request object
   * @param baseUrl Upstream API base URL
   * @param key Upstream API key
   * @returns HTTP Request object
   */
  transformRequest(request: InternalLLMRequest, baseUrl: string, key: string): Promise<Request>;

  /**
   * Convert upstream API response to internal format
   * @param response HTTP Response object
   * @returns Internal LLM response object
   */
  transformResponse(response: Response): Promise<InternalLLMResponse>;

  /**
   * Convert upstream streaming event data to internal format
   * @param eventData SSE event data (Uint8Array)
   * @returns Internal streaming response object, or null if skipped
   */
  transformStream(eventData: Uint8Array): Promise<InternalLLMResponse | null>;
}

/**
 * Transformer factory function type
 */
export type TransformerFactory<T> = () => T;

/**
 * Inbound transformer type
 */
export type InboundType = 'openai-chat' | 'openai-response' | 'anthropic' | 'openai-embedding';

/**
 * Outbound transformer type enum
 */
export enum OutboundTypeEnum {
  OpenAIChat = 0,
  OpenAIResponse = 1,
  Anthropic = 2,
  Gemini = 3,
  Volcengine = 4,
  OpenAIEmbedding = 5,
}
