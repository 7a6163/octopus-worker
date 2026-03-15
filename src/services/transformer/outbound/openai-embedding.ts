/**
 * OpenAI Embeddings outbound transformer
 * Corresponds to internal/transformer/outbound/openai/embedding.go in the original Go project
 *
 * Responsibilities:
 * - Convert internal Embedding requests to OpenAI upstream API format
 * - Convert upstream Embedding responses back to internal format
 */

import type { EmbeddingObject, InternalLLMRequest, InternalLLMResponse } from '@/types/llm';
import type { OutboundTransformer } from '../interface';

interface UpstreamEmbeddingResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  data: EmbeddingObject[];
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIEmbeddingOutbound implements OutboundTransformer {
  async transformRequest(
    request: InternalLLMRequest,
    baseUrl: string,
    key: string
  ): Promise<Request> {
    if (!request.embeddingInput) {
      throw new Error('not an embedding request');
    }

    const bodyObj: Record<string, unknown> = {
      model: request.model,
      input: request.embeddingInput,
    };

    if (request.embeddingDimensions !== undefined) {
      bodyObj.dimensions = request.embeddingDimensions;
    }
    if (request.embeddingEncodingFormat !== undefined) {
      bodyObj.encoding_format = request.embeddingEncodingFormat;
    }
    if (request.user !== undefined) {
      bodyObj.user = request.user;
    }

    const url = new URL(baseUrl.replace(/\/$/, ''));
    url.pathname = `${url.pathname}/embeddings`;

    return new Request(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(bodyObj),
    });
  }

  async transformResponse(response: Response): Promise<InternalLLMResponse> {
    const text = await response.text();
    if (!text) {
      throw new Error('Response body is empty');
    }

    let parsed: UpstreamEmbeddingResponse;
    try {
      parsed = JSON.parse(text) as UpstreamEmbeddingResponse;
    } catch {
      throw new Error(`Failed to parse embedding response: ${text.slice(0, 200)}`);
    }

    return {
      id: parsed.id,
      object: parsed.object || 'list',
      created: parsed.created,
      model: parsed.model,
      choices: [], // Embeddings don't use choices
      embeddingData: parsed.data,
      usage: parsed.usage
        ? {
            promptTokens: parsed.usage.prompt_tokens,
            completionTokens: 0,
            totalTokens: parsed.usage.total_tokens,
          }
        : undefined,
    };
  }

  async transformStream(_eventData: Uint8Array): Promise<InternalLLMResponse | null> {
    // Embedding API does not support streaming
    return null;
  }
}
