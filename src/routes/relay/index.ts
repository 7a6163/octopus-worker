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
relay.get('/models', (c) => {
  // TODO: Phase 2 read model list from database
  return c.json({
    object: 'list',
    data: [
      {
        id: 'gpt-4',
        object: 'model',
        created: 1686935002,
        owned_by: 'octopus',
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        object: 'model',
        created: 1686935002,
        owned_by: 'octopus',
      },
    ],
  });
});

export default relay;
