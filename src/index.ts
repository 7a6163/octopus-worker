/**
 * Octopus Workers 入口檔案
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings, Variables } from '@/types';

// 匯出 Durable Objects
export { RoundRobinCounter } from '@/durable-objects/round-robin-counter';
export { StatsAggregator } from '@/durable-objects/stats-aggregator';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ==================== 全域中間件 ====================

// 日誌記錄
app.use('*', logger());

// CORS
app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  })
);

// 請求 ID 與時間戳記
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  c.set('startTime', Date.now());
  await next();
});

// ==================== 健康檢查 ====================

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'octopus-workers',
    timestamp: Date.now(),
  });
});

app.get('/', (c) => {
  return c.json({
    name: 'Octopus Workers',
    description: 'LLM API Aggregation & Load Balancing Service',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      relay: {
        openai_chat: '/v1/chat/completions',
        openai_response: '/v1/responses',
        anthropic: '/v1/messages',
        openai_embedding: '/v1/embeddings',
      },
      admin: '/api/v1/*',
    },
  });
});

// ==================== API 路由 ====================

// Relay API
import relayRoutes from '@/routes/relay';
app.route('/v1', relayRoutes);

// Admin API
import adminRoutes from '@/routes/admin';
app.route('/api/v1', adminRoutes);

// ==================== 404 處理 ====================

app.notFound((c) => {
  return c.json(
    {
      error: {
        message: 'Not Found',
        type: 'not_found_error',
        path: c.req.path,
      },
    },
    404
  );
});

// ==================== 錯誤處理 ====================

app.onError((err, c) => {
  console.error('Error:', err);

  return c.json(
    {
      error: {
        message: err.message || 'Internal Server Error',
        type: 'internal_server_error',
      },
    },
    500
  );
});

// ==================== 匯出 ====================

import { handleScheduled } from '@/services/cron/handler';

export default {
  fetch: app.fetch,

  // Cron Triggers
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    await handleScheduled(event, env, ctx);
  },
};
