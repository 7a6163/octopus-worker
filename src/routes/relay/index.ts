/**
 * Relay API routes
 * Corresponds to the original Go project's internal/server/handlers/relay.go
 *
 * Endpoints:
 * - POST /v1/chat/completions - OpenAI Chat Completions
 * - POST /v1/responses - OpenAI Responses
 * - POST /v1/messages - Anthropic Messages
 * - POST /v1/embeddings - OpenAI Embeddings
 */

import { Hono } from 'hono';
import { apiKeyAuth } from '@/middleware/auth';
import { relayRateLimit } from '@/middleware/rate-limit';
import { requireJson, validateBodySize } from '@/middleware/validate';
import type { Bindings, Variables } from '@/types';
import { listGroups } from '@/services/db/group';
import { relayHandler } from './handler';

const relay = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ==================== Global Middleware ====================

// API key authentication
relay.use('*', apiKeyAuth());

// Rate limiting (per API key, 600 req/min) — after auth so key is always present
relay.use('*', relayRateLimit());

// Request body size limit (10MB)
relay.use('*', validateBodySize(10 * 1024 * 1024));

// ==================== API Endpoints ====================

/**
 * OpenAI Chat Completions API
 * POST /v1/chat/completions
 */
relay.post('/chat/completions', requireJson(), (c) => {
  return relayHandler(c, 'openai-chat');
});

/**
 * OpenAI Responses API (Reasoning Models)
 * POST /v1/responses
 */
relay.post('/responses', requireJson(), (c) => {
  return relayHandler(c, 'openai-response');
});

/**
 * Anthropic Messages API
 * POST /v1/messages
 */
relay.post('/messages', requireJson(), (c) => {
  return relayHandler(c, 'anthropic');
});

/**
 * OpenAI Embeddings API
 * POST /v1/embeddings
 */
relay.post('/embeddings', requireJson(), (c) => {
  return relayHandler(c, 'openai-embedding');
});

/**
 * OpenAI Models List (compatibility)
 * GET /v1/models
 */
relay.get('/models', async (c) => {
  const groups = await listGroups(c.env.DB);
  const models = groups.map((group) => ({
    id: group.name,
    object: 'model' as const,
    owned_by: 'octopus',
  }));

  return c.json({
    object: 'list',
    data: models,
  });
});

export default relay;
