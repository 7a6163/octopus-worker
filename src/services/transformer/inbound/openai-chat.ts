/**
 * OpenAI Chat Completions inbound transformer
 * Corresponds to internal/transformer/inbound/openai/messages.go in the original Go project
 */

import type { InternalLLMRequest, InternalLLMResponse } from '@/types/llm';
import type { InboundTransformer } from '../interface';

export class OpenAIChatInbound implements InboundTransformer {
  private lastResponse: InternalLLMResponse | null = null;

  /**
   * Convert client OpenAI-format request to internal format
   */
  async transformRequest(body: ArrayBuffer): Promise<InternalLLMRequest> {
    const text = new TextDecoder().decode(body);

    if (!text) {
      throw new Error('Request body is empty');
    }

    try {
      const request = JSON.parse(text) as InternalLLMRequest;

      // Validate required fields
      if (!request.model) {
        throw new Error('model is required');
      }

      if (!request.messages || !Array.isArray(request.messages)) {
        throw new Error('messages is required and must be an array');
      }

      if (request.messages.length === 0) {
        throw new Error('messages array cannot be empty');
      }

      return request;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${err.message}`);
      }
      throw err;
    }
  }

  /**
   * Convert internal response to OpenAI format
   */
  async transformResponse(response: InternalLLMResponse): Promise<Uint8Array> {
    this.lastResponse = response;

    const text = JSON.stringify(response);
    return new TextEncoder().encode(text);
  }

  /**
   * Convert internal streaming response to OpenAI SSE format
   */
  async transformStream(stream: InternalLLMResponse): Promise<Uint8Array | null> {
    this.lastResponse = stream;

    // [DONE] signal
    if (stream.object === '[DONE]') {
      return new TextEncoder().encode('data: [DONE]\n\n');
    }

    // Normal streaming data
    const text = JSON.stringify(stream);
    return new TextEncoder().encode(`data: ${text}\n\n`);
  }

  /**
   * Get the last internal response
   */
  getInternalResponse(): InternalLLMResponse | null {
    return this.lastResponse;
  }
}
