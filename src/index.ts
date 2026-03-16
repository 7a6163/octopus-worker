/**
 * Octopus Workers entry file
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings, Variables } from '@/types';

// Export Durable Objects
export { RoundRobinCounter } from '@/durable-objects/round-robin-counter';
export { StatsAggregator } from '@/durable-objects/stats-aggregator';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ==================== Global Middleware ====================

// Logging
app.use('*', logger());

// CORS — allow origins from CORS_ORIGINS env var (comma-separated), or all origins if unset (local dev)
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const allowedRaw = c.env.CORS_ORIGINS;
      if (!allowedRaw) return origin; // env var not set — allow all (local dev)
      const allowed = allowedRaw.split(',').map((s: string) => s.trim());
      return allowed.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  })
);

// Security response headers
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// Request ID and timestamp
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  c.set('startTime', Date.now());
  await next();
});

// ==================== Health Check ====================

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

// ==================== API Routes ====================

// Relay API
import relayRoutes from '@/routes/relay';

app.route('/v1', relayRoutes);

// Admin API
import adminRoutes from '@/routes/admin';

app.route('/api/v1', adminRoutes);

// ==================== 404 Handler ====================

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

// ==================== Error Handler ====================

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

// ==================== Export ====================

import { handleScheduled } from '@/services/cron/handler';

export default {
  fetch: app.fetch,

  // Cron Triggers
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    await handleScheduled(event, env, ctx);
  },
};
