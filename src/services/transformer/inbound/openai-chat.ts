/**
 * OpenAI Chat Completions Inbound 轉換器
 * 對應原始 Go 專案的 internal/transformer/inbound/openai/messages.go
 */

import type { InboundTransformer } from '../interface';
import type { InternalLLMRequest, InternalLLMResponse } from '@/types/llm';

export class OpenAIChatInbound implements InboundTransformer {
  private lastResponse: InternalLLMResponse | null = null;

  /**
   * 將客戶端 OpenAI 格式請求轉換為內部格式
   */
  async transformRequest(body: ArrayBuffer): Promise<InternalLLMRequest> {
    const text = new TextDecoder().decode(body);

    if (!text) {
      throw new Error('Request body is empty');
    }

    try {
      const request = JSON.parse(text) as InternalLLMRequest;

      // 驗證必要欄位
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
   * 將內部格式回應轉換為 OpenAI 格式
   */
  async transformResponse(response: InternalLLMResponse): Promise<Uint8Array> {
    this.lastResponse = response;

    const text = JSON.stringify(response);
    return new TextEncoder().encode(text);
  }

  /**
   * 將內部流式回應轉換為 OpenAI SSE 格式
   */
  async transformStream(stream: InternalLLMResponse): Promise<Uint8Array | null> {
    this.lastResponse = stream;

    // [DONE] 訊號
    if (stream.object === '[DONE]') {
      return new TextEncoder().encode('data: [DONE]\n\n');
    }

    // 正常流式資料
    const text = JSON.stringify(stream);
    return new TextEncoder().encode(`data: ${text}\n\n`);
  }

  /**
   * 取得最後的內部回應
   */
  getInternalResponse(): InternalLLMResponse | null {
    return this.lastResponse;
  }
}
