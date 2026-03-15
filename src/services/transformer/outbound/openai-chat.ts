/**
 * OpenAI Chat Completions outbound transformer
 * Corresponds to internal/transformer/outbound/openai/chat.go in the original Go project
 */

import type { InternalLLMRequest, InternalLLMResponse } from '@/types/llm';
import type { OutboundTransformer } from '../interface';

export class OpenAIChatOutbound implements OutboundTransformer {
  /**
   * Convert internal request to OpenAI Chat Completions API request
   */
  async transformRequest(
    request: InternalLLMRequest,
    baseUrl: string,
    key: string
  ): Promise<Request> {
    // Clean helper fields
    const cleanedRequest = this.cleanHelpFields(request);

    // Convert developer role to system role (OpenAI doesn't support developer)
    for (const msg of cleanedRequest.messages) {
      if (msg.role === 'developer') {
        msg.role = 'system';
      }
    }

    // Ensure streaming responses include usage info
    if (cleanedRequest.stream) {
      if (!cleanedRequest.streamOptions) {
        cleanedRequest.streamOptions = { includeUsage: true };
      } else if (!cleanedRequest.streamOptions.includeUsage) {
        cleanedRequest.streamOptions.includeUsage = true;
      }
    }

    // Serialize request body
    const body = JSON.stringify(cleanedRequest);

    // Build full URL
    const url = new URL(baseUrl.replace(/\/$/, ''));
    url.pathname = `${url.pathname}/chat/completions`;

    // Create HTTP request
    return new Request(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body,
    });
  }

  /**
   * Convert OpenAI response to internal format
   */
  async transformResponse(response: Response): Promise<InternalLLMResponse> {
    const text = await response.text();

    if (!text) {
      throw new Error('Response body is empty');
    }

    try {
      const data = JSON.parse(text) as InternalLLMResponse;

      // Check for errors
      if (data.error) {
        throw new Error(data.error.message || 'Unknown error');
      }

      return data;
    } catch (err) {
      if (err instanceof Error && err.message !== 'Response body is empty') {
        throw err;
      }
      throw new Error(`Failed to parse response: ${text.slice(0, 200)}`);
    }
  }

  /**
   * Convert OpenAI SSE streaming events to internal format
   */
  async transformStream(eventData: Uint8Array): Promise<InternalLLMResponse | null> {
    const text = new TextDecoder().decode(eventData);

    // Skip empty lines
    if (!text || text.trim() === '') {
      return null;
    }

    // Check for [DONE] signal
    if (text.trim() === '[DONE]') {
      return {
        object: '[DONE]',
        choices: [],
      };
    }

    try {
      const data = JSON.parse(text) as InternalLLMResponse;

      // Check for errors
      if (data.error) {
        throw new Error(data.error.message || 'Stream error');
      }

      return data;
    } catch (err) {
      // Return null on parse failure (skip this event)
      console.warn('Failed to parse stream event:', text.slice(0, 100), err);
      return null;
    }
  }

  /**
   * Clean helper fields (these fields are only used for internal processing)
   */
  private cleanHelpFields(request: InternalLLMRequest): InternalLLMRequest {
    const { query, transformerMetadata, ...cleaned } = request;
    return cleaned as InternalLLMRequest;
  }
}
