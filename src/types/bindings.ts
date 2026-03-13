/**
 * Cloudflare Workers 環境綁定
 */
export interface Bindings {
  // D1 資料庫
  DB: D1Database;

  // Workers KV
  CACHE: KVNamespace;

  // Durable Objects
  STATS_AGGREGATOR: DurableObjectNamespace;
  ROUND_ROBIN_COUNTER: DurableObjectNamespace;

  // 環境變數
  JWT_SECRET?: string;
  ENVIRONMENT?: 'development' | 'production';
}

/**
 * Hono Context 擴展
 */
export interface Variables {
  // 認證相關
  userId?: number;
  username?: string;
  apiKeyId?: number;
  apiKeyName?: string;
  supportedModels?: string;

  // 請求資訊
  requestId?: string;
  startTime?: number;
}
