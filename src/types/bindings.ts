/**
 * Cloudflare Workers environment bindings
 */
export interface Bindings {
  // D1 Database
  DB: D1Database;

  // Workers KV
  CACHE: KVNamespace;

  // Durable Objects
  STATS_AGGREGATOR: DurableObjectNamespace;
  ROUND_ROBIN_COUNTER: DurableObjectNamespace;

  // Environment variables
  JWT_SECRET?: string;
  ENVIRONMENT?: 'development' | 'production';
  CORS_ORIGINS?: string;
}

/**
 * Hono Context extensions
 */
export interface Variables {
  // Authentication
  userId?: number;
  username?: string;
  role?: 'admin' | 'user';
  apiKeyId?: number;
  apiKeyName?: string;
  supportedModels?: string;

  // Request info
  requestId?: string;
  startTime?: number;
}
