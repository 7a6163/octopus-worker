/**
 * Volcengine outbound transformer
 * ByteDance Volcengine LLM API — thin wrapper over the OpenAI Responses API
 *
 * Features:
 * - Delegates request/response conversion to OpenAI Response outbound
 * - Only specific models support reasoning (doubao-seed series)
 * - Does not support the metadata parameter
 */

import type { InternalLLMRequest, InternalLLMResponse } from '@/types/llm';
import type { OutboundTransformer } from '../interface';
import { OpenAIResponseOutbound } from './openai-response';

/** Models that support reasoning */
const REASONING_MODELS = new Set([
  'doubao-seed-1-8-251228',
  'doubao-seed-1-6-lite-251015',
  'doubao-seed-1-6-251015',
]);

export class VolcengineOutbound implements OutboundTransformer {
  private readonly inner = new OpenAIResponseOutbound();

  async transformRequest(
    request: InternalLLMRequest,
    baseUrl: string,
    key: string
  ): Promise<Request> {
    // Immutably strip unsupported fields
    const modifiedRequest: InternalLLMRequest = {
      ...request,
      // Strip metadata — Volcengine doesn't support it
      metadata: undefined,
      // Strip reasoning for non-reasoning models
      reasoningEffort: REASONING_MODELS.has(request.model) ? request.reasoningEffort : undefined,
      reasoningBudget: REASONING_MODELS.has(request.model) ? request.reasoningBudget : undefined,
    };

    return this.inner.transformRequest(modifiedRequest, baseUrl, key);
  }

  async transformResponse(response: Response): Promise<InternalLLMResponse> {
    return this.inner.transformResponse(response);
  }

  async transformStream(eventData: Uint8Array): Promise<InternalLLMResponse | null> {
    return this.inner.transformStream(eventData);
  }
}
