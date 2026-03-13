/**
 * OpenAI Chat Completions Outbound 轉換器
 * 對應原始 Go 專案的 internal/transformer/outbound/openai/chat.go
 */

import type { OutboundTransformer } from '../interface';
import type { InternalLLMRequest, InternalLLMResponse } from '@/types/llm';

export class OpenAIChatOutbound implements OutboundTransformer {
  /**
   * 轉換內部請求為 OpenAI Chat Completions API 請求
   */
  async transformRequest(
    request: InternalLLMRequest,
    baseUrl: string,
    key: string
  ): Promise<Request> {
    // 清理輔助欄位
    const cleanedRequest = this.cleanHelpFields(request);

    // 轉換 developer role 為 system role (OpenAI 不支援 developer)
    for (const msg of cleanedRequest.messages) {
      if (msg.role === 'developer') {
        msg.role = 'system';
      }
    }

    // 確保流式回應包含 usage 資訊
    if (cleanedRequest.stream) {
      if (!cleanedRequest.streamOptions) {
        cleanedRequest.streamOptions = { includeUsage: true };
      } else if (!cleanedRequest.streamOptions.includeUsage) {
        cleanedRequest.streamOptions.includeUsage = true;
      }
    }

    // 序列化請求體
    const body = JSON.stringify(cleanedRequest);

    // 構建完整 URL
    const url = new URL(baseUrl.replace(/\/$/, ''));
    url.pathname = url.pathname + '/chat/completions';

    // 建立 HTTP 請求
    return new Request(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body,
    });
  }

  /**
   * 轉換 OpenAI 回應為內部格式
   */
  async transformResponse(response: Response): Promise<InternalLLMResponse> {
    const text = await response.text();

    if (!text) {
      throw new Error('Response body is empty');
    }

    try {
      const data = JSON.parse(text) as InternalLLMResponse;

      // 檢查錯誤
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
   * 轉換 OpenAI SSE 流式事件為內部格式
   */
  async transformStream(eventData: Uint8Array): Promise<InternalLLMResponse | null> {
    const text = new TextDecoder().decode(eventData);

    // 跳過空行
    if (!text || text.trim() === '') {
      return null;
    }

    // 檢查 [DONE] 訊號
    if (text.trim() === '[DONE]') {
      return {
        object: '[DONE]',
        choices: [],
      };
    }

    try {
      const data = JSON.parse(text) as InternalLLMResponse;

      // 檢查錯誤
      if (data.error) {
        throw new Error(data.error.message || 'Stream error');
      }

      return data;
    } catch (err) {
      // 解析失敗時返回 null（跳過此事件）
      console.warn('Failed to parse stream event:', text.slice(0, 100), err);
      return null;
    }
  }

  /**
   * 清理輔助欄位（這些欄位僅用於內部處理）
   */
  private cleanHelpFields(request: InternalLLMRequest): InternalLLMRequest {
    const { query, transformerMetadata, ...cleaned } = request;
    return cleaned as InternalLLMRequest;
  }
}
