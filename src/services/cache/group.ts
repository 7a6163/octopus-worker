/**
 * Group cache layer
 * Uses Workers KV for caching
 *
 * Cache strategy:
 * - Indexed by model name (with regex matching support)
 * - TTL: 5 minutes (300 seconds)
 * - Write-through: update cache on write
 * - Cache penetration protection: cache null results (TTL: 1 minute)
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { getGroupById, getGroupByModel } from '@/services/db/group';
import type { Group } from '@/types/group';

const CACHE_TTL = 300; // 5 minutes
const NULL_CACHE_TTL = 60; // 1 minute (for caching non-existent records)

/**
 * Cache key prefixes
 */
const KEY_PREFIX_MODEL = 'group:model:'; // Indexed by model name
const KEY_PREFIX_ID = 'group:id:'; // Indexed by ID

/**
 * Generate a cache key by model name
 */
function getModelCacheKey(modelName: string): string {
  return `${KEY_PREFIX_MODEL}${modelName}`;
}

/**
 * Generate a cache key by ID
 */
function getIdCacheKey(id: number): string {
  return `${KEY_PREFIX_ID}${id}`;
}

/**
 * Get a Group from cache by model name
 * Falls back to DB on cache miss
 */
export async function getCachedGroupByModel(
  kv: KVNamespace,
  db: D1Database,
  modelName: string
): Promise<Group | null> {
  const cacheKey = getModelCacheKey(modelName);

  // 1. Try reading from cache
  const cached = await kv.get(cacheKey, 'text');
  if (cached !== null) {
    // Cache hit
    if (cached === '__NULL__') {
      // Cached null result
      return null;
    }
    try {
      return JSON.parse(cached) as Group;
    } catch (err) {
      console.error('Failed to parse cached group:', err);
      // Cache parse failed; delete and fall back to DB
      await kv.delete(cacheKey);
    }
  }

  // 2. Cache miss; read from DB
  const group = await getGroupByModel(db, modelName);

  // 3. Write to cache
  if (group === null) {
    // Cache null result (prevent cache penetration)
    await kv.put(cacheKey, '__NULL__', { expirationTtl: NULL_CACHE_TTL });
  } else {
    // Cache result (dual-indexed by model name and ID)
    await Promise.all([
      kv.put(cacheKey, JSON.stringify(group), { expirationTtl: CACHE_TTL }),
      kv.put(getIdCacheKey(group.id), JSON.stringify(group), { expirationTtl: CACHE_TTL }),
    ]);
  }

  return group;
}

/**
 * Get a Group from cache by ID
 */
export async function getCachedGroupById(
  kv: KVNamespace,
  db: D1Database,
  id: number
): Promise<Group | null> {
  const cacheKey = getIdCacheKey(id);

  // 1. Try reading from cache
  const cached = await kv.get(cacheKey, 'text');
  if (cached !== null) {
    // Cache hit
    if (cached === '__NULL__') {
      return null;
    }
    try {
      return JSON.parse(cached) as Group;
    } catch (err) {
      console.error('Failed to parse cached group:', err);
      await kv.delete(cacheKey);
    }
  }

  // 2. Cache miss; read from DB
  const group = await getGroupById(db, id);

  // 3. Write to cache
  if (group === null) {
    await kv.put(cacheKey, '__NULL__', { expirationTtl: NULL_CACHE_TTL });
  } else {
    // Dual-indexed cache
    await Promise.all([
      kv.put(cacheKey, JSON.stringify(group), { expirationTtl: CACHE_TTL }),
      kv.put(getModelCacheKey(group.name), JSON.stringify(group), { expirationTtl: CACHE_TTL }),
    ]);
  }

  return group;
}

/**
 * Invalidate cache by model name
 */
export async function invalidateGroupCacheByModel(
  kv: KVNamespace,
  modelName: string
): Promise<void> {
  const cacheKey = getModelCacheKey(modelName);
  await kv.delete(cacheKey);
}

/**
 * Invalidate cache by ID
 */
export async function invalidateGroupCacheById(kv: KVNamespace, id: number): Promise<void> {
  const cacheKey = getIdCacheKey(id);
  await kv.delete(cacheKey);
}

/**
 * Invalidate all cache entries for a Group (both model name and ID indexes)
 */
export async function invalidateGroupCache(
  kv: KVNamespace,
  groupOrId: Group | number
): Promise<void> {
  if (typeof groupOrId === 'number') {
    // Only delete by ID cache
    await kv.delete(getIdCacheKey(groupOrId));
  } else {
    // Delete both model and ID caches
    await Promise.all([
      kv.delete(getModelCacheKey(groupOrId.name)),
      kv.delete(getIdCacheKey(groupOrId.id)),
    ]);
  }
}

/**
 * Warm up cache (batch-load all Groups)
 */
export async function warmupGroupCache(kv: KVNamespace, db: D1Database): Promise<number> {
  const allGroups = await db
    .prepare(
      `SELECT id, name, mode, match_regex, first_token_time_out
       FROM groups
       ORDER BY id ASC`
    )
    .all<{
      id: number;
      name: string;
      mode: number;
      match_regex: string;
      first_token_time_out: number;
    }>();

  if (!allGroups.results || allGroups.results.length === 0) {
    return 0;
  }

  const putPromises: Promise<void>[] = [];

  for (const groupData of allGroups.results) {
    // Query GroupItems
    const itemsResult = await db
      .prepare(
        `SELECT id, group_id, channel_id, model_name, priority, weight
         FROM group_items
         WHERE group_id = ?
         ORDER BY priority ASC, id ASC`
      )
      .bind(groupData.id)
      .all();

    const group: Group = {
      id: groupData.id,
      name: groupData.name,
      mode: groupData.mode,
      matchRegex: groupData.match_regex,
      firstTokenTimeOut: groupData.first_token_time_out,
      items: (itemsResult.results || []).map((item: any) => ({
        id: item.id,
        groupId: item.group_id,
        channelId: item.channel_id,
        modelName: item.model_name,
        priority: item.priority,
        weight: item.weight,
      })),
    };

    // Dual-indexed cache
    putPromises.push(
      kv.put(getModelCacheKey(group.name), JSON.stringify(group), { expirationTtl: CACHE_TTL })
    );
    putPromises.push(
      kv.put(getIdCacheKey(group.id), JSON.stringify(group), { expirationTtl: CACHE_TTL })
    );
  }

  await Promise.all(putPromises);
  return allGroups.results.length;
}

/**
 * Clear all Group cache entries
 */
export async function clearAllGroupCache(_kv: KVNamespace): Promise<void> {
  // Workers KV does not support prefix-based bulk deletion; all keys must be listed first.
  // Since this is expensive, prefer letting entries expire via TTL.
  // This is a placeholder; consider alternative approaches in production.

  console.warn('clearAllGroupCache: This operation is expensive and not recommended');
  // If clearing is truly needed, manually invalidate related caches when updating a Group.
}
