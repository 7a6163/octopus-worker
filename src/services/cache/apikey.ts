/**
 * APIKey cache layer
 * Uses Workers KV for caching
 *
 * Cache strategy:
 * - TTL: 5 minutes (300 seconds)
 * - Cache penetration protection: cache null results (TTL: 1 minute)
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { validateAPIKey } from '@/services/db/apikey';
import type { APIKey } from '@/types/apikey';

const CACHE_TTL = 300; // 5 minutes
const NULL_CACHE_TTL = 60; // 1 minute (for caching non-existent records)

/**
 * Cache key prefix
 */
const KEY_PREFIX = 'apikey:';

/**
 * Generate a cache key
 */
function getCacheKey(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

/**
 * Get and validate an APIKey from cache
 */
export async function getCachedAPIKey(
  kv: KVNamespace,
  db: D1Database,
  key: string
): Promise<APIKey | null> {
  const cacheKey = getCacheKey(key);

  // 1. Try reading from cache
  const cached = await kv.get(cacheKey, 'text');
  if (cached !== null) {
    // Cache hit
    if (cached === '__NULL__') {
      // Cached null result (invalid key)
      return null;
    }
    try {
      return JSON.parse(cached) as APIKey;
    } catch (err) {
      console.error('Failed to parse cached API key:', err);
      // Cache parse failed; delete and fall back to DB
      await kv.delete(cacheKey);
    }
  }

  // 2. Cache miss; validate from DB
  const apiKey = await validateAPIKey(db, key);

  // 3. Write to cache
  if (apiKey === null) {
    // Cache null result (prevent cache penetration)
    await kv.put(cacheKey, '__NULL__', { expirationTtl: NULL_CACHE_TTL });
  } else {
    // Cache the result
    await kv.put(cacheKey, JSON.stringify(apiKey), { expirationTtl: CACHE_TTL });
  }

  return apiKey;
}

/**
 * Invalidate cache entry
 */
export async function invalidateAPIKeyCache(kv: KVNamespace, key: string): Promise<void> {
  const cacheKey = getCacheKey(key);
  await kv.delete(cacheKey);
}
