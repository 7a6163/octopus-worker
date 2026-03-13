/**
 * Volcengine Outbound 轉換器
 * 字節跳動火山引擎 LLM API — 基於 OpenAI Responses API 的薄封裝
 *
 * 特性：
 * - 委託 OpenAI Response outbound 處理請求/回應轉換
 * - 僅特定模型支援 reasoning（doubao-seed 系列）
 * - 不支援 metadata 參數
 */

import { OpenAIResponseOutbound } from './openai-response';
import type { OutboundTransformer } from '../interface';
import type { InternalLLMRequest, InternalLLMResponse } from '@/types/llm';

/** 支援 reasoning 的模型集合 */
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
      reasoningEffort: REASONING_MODELS.has(request.model)
        ? request.reasoningEffort
        : undefined,
      reasoningBudget: REASONING_MODELS.has(request.model)
        ? request.reasoningBudget
        : undefined,
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
