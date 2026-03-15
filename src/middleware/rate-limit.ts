/**
 * Simple rate limiting middleware using Workers KV.
 *
 * Uses a sliding window approach: stores request count per key per minute.
 * Not perfectly precise (KV eventual consistency) but sufficient for
 * protecting against brute force and abuse on Workers.
 */

import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '@/types';

interface RateLimitOptions {
  /** Max requests per window */
  limit: number;
  /** Window size in seconds (default: 60) */
  windowSec?: number;
  /** Function to derive the rate limit key from the request */
  keyFn: (c: any) => string;
}

/**
 * Rate limiting middleware.
 *
 * Uses KV to track request counts per key. Each key gets a TTL-based counter.
 * On Workers, KV writes are eventually consistent, so this is best-effort
 * rather than strictly precise — acceptable for abuse prevention.
 */
export function rateLimit(opts: RateLimitOptions) {
  const windowSec = opts.windowSec ?? 60;

  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const key = opts.keyFn(c);
    if (!key) return await next();

    const cacheKey = `rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;

    try {
      const current = await c.env.CACHE.get(cacheKey, 'text');
      const count = current ? parseInt(current, 10) : 0;

      if (count >= opts.limit) {
        return c.json(
          {
            error: {
              message: 'Rate limit exceeded. Please retry later.',
              type: 'rate_limit_error',
            },
          },
          429
        );
      }

      // Increment — fire-and-forget (don't block the request)
      c.executionCtx.waitUntil(
        c.env.CACHE.put(cacheKey, String(count + 1), {
          expirationTtl: windowSec * 2,
        })
      );
    } catch {
      // KV failure should not block requests — fail open
    }

    return await next();
  });
}

/**
 * Rate limit by client IP — for login/auth endpoints.
 * Default: 20 requests per minute per IP.
 */
export const loginRateLimit = (limit = 20) =>
  rateLimit({
    limit,
    windowSec: 60,
    keyFn: (c) =>
      `login:${c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'}`,
  });

/**
 * Rate limit by API key — for relay endpoints.
 * Default: 600 requests per minute per key.
 */
export const relayRateLimit = (limit = 600) =>
  rateLimit({
    limit,
    windowSec: 60,
    keyFn: (c) => {
      const auth = c.req.header('Authorization') || '';
      const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      return key ? `relay:${key}` : '';
    },
  });
