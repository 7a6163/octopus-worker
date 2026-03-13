/**
 * 協議轉換器介面
 * 對應原始 Go 專案的 internal/transformer/model/interface.go
 */

import type { InternalLLMRequest, InternalLLMResponse } from '@/types/llm';

/**
 * Inbound 轉換器介面
 * 負責將客戶端請求轉換為內部格式，並將內部格式轉回客戶端格式
 */
export interface InboundTransformer {
  /**
   * 將客戶端請求體轉換為內部 LLM 請求格式
   * @param body 客戶端請求的 ArrayBuffer
   * @returns 內部 LLM 請求物件
   */
  transformRequest(body: ArrayBuffer): Promise<InternalLLMRequest>;

  /**
   * 將內部回應格式轉換為客戶端格式
   * @param response 內部 LLM 回應物件
   * @returns 客戶端格式的回應 Uint8Array
   */
  transformResponse(response: InternalLLMResponse): Promise<Uint8Array>;

  /**
   * 將內部流式回應轉換為客戶端格式
   * @param stream 內部流式回應物件
   * @returns 客戶端格式的 SSE 事件 Uint8Array，如果跳過則返回 null
   */
  transformStream(stream: InternalLLMResponse): Promise<Uint8Array | null>;

  /**
   * 取得最後處理的內部回應（用於統計）
   * @returns 內部回應物件或 null
   */
  getInternalResponse(): InternalLLMResponse | null;
}

/**
 * Outbound 轉換器介面
 * 負責將內部格式轉換為上游 API 格式，並將上游回應轉回內部格式
 */
export interface OutboundTransformer {
  /**
   * 將內部請求轉換為上游 API 請求
   * @param request 內部 LLM 請求物件
   * @param baseUrl 上游 API Base URL
   * @param key 上游 API Key
   * @returns HTTP Request 物件
   */
  transformRequest(
    request: InternalLLMRequest,
    baseUrl: string,
    key: string
  ): Promise<Request>;

  /**
   * 將上游 API 回應轉換為內部格式
   * @param response HTTP Response 物件
   * @returns 內部 LLM 回應物件
   */
  transformResponse(response: Response): Promise<InternalLLMResponse>;

  /**
   * 將上游流式事件資料轉換為內部格式
   * @param eventData SSE 事件資料 (Uint8Array)
   * @returns 內部流式回應物件，如果跳過則返回 null
   */
  transformStream(eventData: Uint8Array): Promise<InternalLLMResponse | null>;
}

/**
 * 轉換器工廠函數類型
 */
export type TransformerFactory<T> = () => T;

/**
 * Inbound 轉換器類型
 */
export type InboundType = 'openai-chat' | 'openai-response' | 'anthropic' | 'openai-embedding';

/**
 * Outbound 轉換器類型枚舉
 */
export enum OutboundTypeEnum {
  OpenAIChat = 0,
  OpenAIResponse = 1,
  Anthropic = 2,
  Gemini = 3,
  Volcengine = 4,
  OpenAIEmbedding = 5,
}
