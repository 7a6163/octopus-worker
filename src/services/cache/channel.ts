/**
 * Channel cache layer
 * Uses Workers KV for caching
 *
 * Cache strategy:
 * - TTL: 5 minutes (300 seconds)
 * - Write-through: update cache on write
 * - Cache penetration protection: cache null results (TTL: 1 minute)
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { getChannel, getChannelsByIds } from '@/services/db/channel';
import type { Channel } from '@/types/channel';

const CACHE_TTL = 300; // 5 minutes
const NULL_CACHE_TTL = 60; // 1 minute (for caching non-existent records)

/**
 * Cache key prefix
 */
const KEY_PREFIX = 'channel:';

/**
 * Generate a cache key
 */
function getCacheKey(id: number): string {
  return `${KEY_PREFIX}${id}`;
}

/**
 * Get a Channel from cache (falls back to DB on cache miss)
 */
export async function getCachedChannel(
  kv: KVNamespace,
  db: D1Database,
  id: number
): Promise<Channel | null> {
  const cacheKey = getCacheKey(id);

  // 1. Try reading from cache
  const cached = await kv.get(cacheKey, 'text');
  if (cached !== null) {
    // Cache hit
    if (cached === '__NULL__') {
      // Cached null result
      return null;
    }
    try {
      return JSON.parse(cached) as Channel;
    } catch (err) {
      console.error('Failed to parse cached channel:', err);
      // Cache parse failed; delete and fall back to DB
      await kv.delete(cacheKey);
    }
  }

  // 2. Cache miss; read from DB
  const channel = await getChannel(db, id);

  // 3. Write to cache
  if (channel === null) {
    // Cache null result (prevent cache penetration)
    await kv.put(cacheKey, '__NULL__', { expirationTtl: NULL_CACHE_TTL });
  } else {
    // Cache the result
    await kv.put(cacheKey, JSON.stringify(channel), { expirationTtl: CACHE_TTL });
  }

  return channel;
}

/**
 * Batch fetch Channels from cache
 */
export async function getCachedChannels(
  kv: KVNamespace,
  db: D1Database,
  ids: number[]
): Promise<Map<number, Channel>> {
  if (ids.length === 0) {
    return new Map();
  }

  const result = new Map<number, Channel>();
  const missingIds: number[] = [];

  // 1. Batch read from cache
  for (const id of ids) {
    const cacheKey = getCacheKey(id);
    const cached = await kv.get(cacheKey, 'text');

    if (cached !== null && cached !== '__NULL__') {
      try {
        const channel = JSON.parse(cached) as Channel;
        result.set(id, channel);
      } catch (err) {
        console.error('Failed to parse cached channel:', err);
        missingIds.push(id);
        await kv.delete(cacheKey);
      }
    } else if (cached === null) {
      missingIds.push(id);
    }
  }

  // 2. Fetch cache-missed records from DB
  if (missingIds.length > 0) {
    const channels = await getChannelsByIds(db, missingIds);

    // 3. Write to cache and add to results
    for (const [id, channel] of channels) {
      result.set(id, channel);
      const cacheKey = getCacheKey(id);
      await kv.put(cacheKey, JSON.stringify(channel), { expirationTtl: CACHE_TTL });
    }

    // 4. Cache non-existent records
    for (const id of missingIds) {
      if (!channels.has(id)) {
        const cacheKey = getCacheKey(id);
        await kv.put(cacheKey, '__NULL__', { expirationTtl: NULL_CACHE_TTL });
      }
    }
  }

  return result;
}

/**
 * Invalidate cache
 */
export async function invalidateChannelCache(kv: KVNamespace, id: number): Promise<void> {
  const cacheKey = getCacheKey(id);
  await kv.delete(cacheKey);
}

/**
 * Invalidate multiple cache entries
 */
export async function invalidateChannelCaches(kv: KVNamespace, ids: number[]): Promise<void> {
  const deletePromises = ids.map((id) => {
    const cacheKey = getCacheKey(id);
    return kv.delete(cacheKey);
  });

  await Promise.all(deletePromises);
}

/**
 * Warm up cache (batch load all enabled Channels)
 */
export async function warmupChannelCache(kv: KVNamespace, db: D1Database): Promise<number> {
  const allChannels = await db
    .prepare(
      `SELECT id, name, type, enabled, base_urls, model, custom_model,
              proxy, auto_sync, auto_group, custom_header
       FROM channels
       WHERE enabled = 1
       ORDER BY id ASC`
    )
    .all<{
      id: number;
      name: string;
      type: number;
      enabled: number;
      base_urls: string;
      model: string;
      custom_model: string;
      proxy: number;
      auto_sync: number;
      auto_group: number;
      custom_header: string;
    }>();

  const channelIds = allChannels.results?.map((ch) => ch.id) || [];

  if (channelIds.length > 0) {
    const channels = await getChannelsByIds(db, channelIds);

    const putPromises: Promise<void>[] = [];
    for (const [id, channel] of channels) {
      const cacheKey = getCacheKey(id);
      putPromises.push(kv.put(cacheKey, JSON.stringify(channel), { expirationTtl: CACHE_TTL }));
    }

    await Promise.all(putPromises);
    return channels.size;
  }

  return 0;
}
