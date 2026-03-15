/**
 * OpenAI Embeddings inbound transformer
 * Corresponds to internal/transformer/inbound/openai/embedding.go in the original Go project
 *
 * Responsibilities:
 * - Convert client OpenAI Embedding requests to internal format
 * - Convert internal Embedding responses back to client format
 */

import type { EmbeddingObject, InternalLLMRequest, InternalLLMResponse } from '@/types/llm';
import type { InboundTransformer } from '../interface';

interface OpenAIEmbeddingRequest {
  model: string;
  input: string | string[];
  dimensions?: number;
  encoding_format?: string;
  user?: string;
}

interface OpenAIEmbeddingResponse {
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

export class OpenAIEmbeddingInbound implements InboundTransformer {
  private lastResponse: InternalLLMResponse | null = null;

  async transformRequest(body: ArrayBuffer): Promise<InternalLLMRequest> {
    const text = new TextDecoder().decode(body);
    if (!text) {
      throw new Error('Request body is empty');
    }

    let parsed: OpenAIEmbeddingRequest;
    try {
      parsed = JSON.parse(text) as OpenAIEmbeddingRequest;
    } catch (err) {
      throw new Error(`Invalid JSON: ${(err as Error).message}`);
    }

    if (!parsed.model) {
      throw new Error('model is required');
    }

    if (parsed.input === undefined || parsed.input === null) {
      throw new Error('input is required');
    }

    return {
      model: parsed.model,
      messages: [], // Embeddings don't use messages
      embeddingInput: parsed.input,
      embeddingDimensions: parsed.dimensions,
      embeddingEncodingFormat: parsed.encoding_format,
      user: parsed.user,
      rawAPIFormat: 'openai/embeddings',
    };
  }

  async transformResponse(response: InternalLLMResponse): Promise<Uint8Array> {
    this.lastResponse = response;

    const openAIResp: OpenAIEmbeddingResponse = {
      id: response.id || '',
      object: response.object || 'list',
      created: response.created || Math.floor(Date.now() / 1000),
      model: response.model || '',
      data: response.embeddingData || [],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.promptTokens,
            total_tokens: response.usage.totalTokens,
          }
        : undefined,
    };

    return new TextEncoder().encode(JSON.stringify(openAIResp));
  }

  async transformStream(_stream: InternalLLMResponse): Promise<Uint8Array | null> {
    // Embedding API does not support streaming
    return null;
  }

  getInternalResponse(): InternalLLMResponse | null {
    return this.lastResponse;
  }
}
