/**
 * Channel 快取層
 * 使用 Workers KV 進行快取
 *
 * 快取策略：
 * - TTL: 5 分鐘（300 秒）
 * - Write-Through: 寫入時同時更新快取
 * - 快取穿透保護：快取 null 結果（TTL: 1 分鐘）
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Channel } from '@/types/channel';
import { getChannel, getChannelsByIds } from '@/services/db/channel';

const CACHE_TTL = 300; // 5 分鐘
const NULL_CACHE_TTL = 60; // 1 分鐘（用於快取不存在的記錄）

/**
 * 快取 Key 前綴
 */
const KEY_PREFIX = 'channel:';

/**
 * 生成快取 Key
 */
function getCacheKey(id: number): string {
  return `${KEY_PREFIX}${id}`;
}

/**
 * 從快取獲取 Channel（如果快取未命中則從 DB 讀取）
 */
export async function getCachedChannel(
  kv: KVNamespace,
  db: D1Database,
  id: number
): Promise<Channel | null> {
  const cacheKey = getCacheKey(id);

  // 1. 嘗試從快取讀取
  const cached = await kv.get(cacheKey, 'text');
  if (cached !== null) {
    // 快取命中
    if (cached === '__NULL__') {
      // 快取的 null 結果
      return null;
    }
    try {
      return JSON.parse(cached) as Channel;
    } catch (err) {
      console.error('Failed to parse cached channel:', err);
      // 快取解析失敗，刪除快取並繼續從 DB 讀取
      await kv.delete(cacheKey);
    }
  }

  // 2. 快取未命中，從 DB 讀取
  const channel = await getChannel(db, id);

  // 3. 寫入快取
  if (channel === null) {
    // 快取 null 結果（防止快取穿透）
    await kv.put(cacheKey, '__NULL__', { expirationTtl: NULL_CACHE_TTL });
  } else {
    // 快取正常結果
    await kv.put(cacheKey, JSON.stringify(channel), { expirationTtl: CACHE_TTL });
  }

  return channel;
}

/**
 * 批次從快取獲取 Channels
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

  // 1. 批次從快取讀取
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

  // 2. 從 DB 讀取快取未命中的記錄
  if (missingIds.length > 0) {
    const channels = await getChannelsByIds(db, missingIds);

    // 3. 寫入快取並添加到結果
    for (const [id, channel] of channels) {
      result.set(id, channel);
      const cacheKey = getCacheKey(id);
      await kv.put(cacheKey, JSON.stringify(channel), { expirationTtl: CACHE_TTL });
    }

    // 4. 快取不存在的記錄
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
 * 使快取失效
 */
export async function invalidateChannelCache(kv: KVNamespace, id: number): Promise<void> {
  const cacheKey = getCacheKey(id);
  await kv.delete(cacheKey);
}

/**
 * 使多個快取失效
 */
export async function invalidateChannelCaches(kv: KVNamespace, ids: number[]): Promise<void> {
  const deletePromises = ids.map((id) => {
    const cacheKey = getCacheKey(id);
    return kv.delete(cacheKey);
  });

  await Promise.all(deletePromises);
}

/**
 * 預熱快取（批次載入所有啟用的 Channels）
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
