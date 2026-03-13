/**
 * APIKey 快取層
 * 使用 Workers KV 進行快取
 *
 * 快取策略：
 * - TTL: 5 分鐘（300 秒）
 * - 快取穿透保護：快取 null 結果（TTL: 1 分鐘）
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { D1Database } from '@cloudflare/workers-types';
import type { APIKey } from '@/types/apikey';
import { validateAPIKey } from '@/services/db/apikey';

const CACHE_TTL = 300; // 5 分鐘
const NULL_CACHE_TTL = 60; // 1 分鐘（用於快取不存在的記錄）

/**
 * 快取 Key 前綴
 */
const KEY_PREFIX = 'apikey:';

/**
 * 生成快取 Key
 */
function getCacheKey(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

/**
 * 從快取獲取並驗證 APIKey
 */
export async function getCachedAPIKey(
  kv: KVNamespace,
  db: D1Database,
  key: string
): Promise<APIKey | null> {
  const cacheKey = getCacheKey(key);

  // 1. 嘗試從快取讀取
  const cached = await kv.get(cacheKey, 'text');
  if (cached !== null) {
    // 快取命中
    if (cached === '__NULL__') {
      // 快取的 null 結果（無效 Key）
      return null;
    }
    try {
      return JSON.parse(cached) as APIKey;
    } catch (err) {
      console.error('Failed to parse cached API key:', err);
      // 快取解析失敗，刪除快取並繼續從 DB 讀取
      await kv.delete(cacheKey);
    }
  }

  // 2. 快取未命中，從 DB 驗證
  const apiKey = await validateAPIKey(db, key);

  // 3. 寫入快取
  if (apiKey === null) {
    // 快取 null 結果（防止快取穿透）
    await kv.put(cacheKey, '__NULL__', { expirationTtl: NULL_CACHE_TTL });
  } else {
    // 快取正常結果
    await kv.put(cacheKey, JSON.stringify(apiKey), { expirationTtl: CACHE_TTL });
  }

  return apiKey;
}

/**
 * 使快取失效
 */
export async function invalidateAPIKeyCache(kv: KVNamespace, key: string): Promise<void> {
  const cacheKey = getCacheKey(key);
  await kv.delete(cacheKey);
}
