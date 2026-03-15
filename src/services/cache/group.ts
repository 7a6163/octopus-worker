/**
 * Group 快取層
 * 使用 Workers KV 進行快取
 *
 * 快取策略：
 * - 按模型名稱索引（支援正則表達式匹配）
 * - TTL: 5 分鐘（300 秒）
 * - Write-Through: 寫入時同時更新快取
 * - 快取穿透保護：快取 null 結果（TTL: 1 分鐘）
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { getGroupById, getGroupByModel } from '@/services/db/group';
import type { Group } from '@/types/group';

const CACHE_TTL = 300; // 5 分鐘
const NULL_CACHE_TTL = 60; // 1 分鐘（用於快取不存在的記錄）

/**
 * 快取 Key 前綴
 */
const KEY_PREFIX_MODEL = 'group:model:'; // 按模型名稱索引
const KEY_PREFIX_ID = 'group:id:'; // 按 ID 索引

/**
 * 生成模型名稱快取 Key
 */
function getModelCacheKey(modelName: string): string {
  return `${KEY_PREFIX_MODEL}${modelName}`;
}

/**
 * 生成 ID 快取 Key
 */
function getIdCacheKey(id: number): string {
  return `${KEY_PREFIX_ID}${id}`;
}

/**
 * 從快取獲取 Group（按模型名稱）
 * 如果快取未命中則從 DB 讀取
 */
export async function getCachedGroupByModel(
  kv: KVNamespace,
  db: D1Database,
  modelName: string
): Promise<Group | null> {
  const cacheKey = getModelCacheKey(modelName);

  // 1. 嘗試從快取讀取
  const cached = await kv.get(cacheKey, 'text');
  if (cached !== null) {
    // 快取命中
    if (cached === '__NULL__') {
      // 快取的 null 結果
      return null;
    }
    try {
      return JSON.parse(cached) as Group;
    } catch (err) {
      console.error('Failed to parse cached group:', err);
      // 快取解析失敗，刪除快取並繼續從 DB 讀取
      await kv.delete(cacheKey);
    }
  }

  // 2. 快取未命中，從 DB 讀取
  const group = await getGroupByModel(db, modelName);

  // 3. 寫入快取
  if (group === null) {
    // 快取 null 結果（防止快取穿透）
    await kv.put(cacheKey, '__NULL__', { expirationTtl: NULL_CACHE_TTL });
  } else {
    // 快取正常結果（按模型名稱和 ID 雙重索引）
    await Promise.all([
      kv.put(cacheKey, JSON.stringify(group), { expirationTtl: CACHE_TTL }),
      kv.put(getIdCacheKey(group.id), JSON.stringify(group), { expirationTtl: CACHE_TTL }),
    ]);
  }

  return group;
}

/**
 * 從快取獲取 Group（按 ID）
 */
export async function getCachedGroupById(
  kv: KVNamespace,
  db: D1Database,
  id: number
): Promise<Group | null> {
  const cacheKey = getIdCacheKey(id);

  // 1. 嘗試從快取讀取
  const cached = await kv.get(cacheKey, 'text');
  if (cached !== null) {
    // 快取命中
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

  // 2. 快取未命中，從 DB 讀取
  const group = await getGroupById(db, id);

  // 3. 寫入快取
  if (group === null) {
    await kv.put(cacheKey, '__NULL__', { expirationTtl: NULL_CACHE_TTL });
  } else {
    // 雙重索引快取
    await Promise.all([
      kv.put(cacheKey, JSON.stringify(group), { expirationTtl: CACHE_TTL }),
      kv.put(getModelCacheKey(group.name), JSON.stringify(group), { expirationTtl: CACHE_TTL }),
    ]);
  }

  return group;
}

/**
 * 使快取失效（按模型名稱）
 */
export async function invalidateGroupCacheByModel(
  kv: KVNamespace,
  modelName: string
): Promise<void> {
  const cacheKey = getModelCacheKey(modelName);
  await kv.delete(cacheKey);
}

/**
 * 使快取失效（按 ID）
 */
export async function invalidateGroupCacheById(kv: KVNamespace, id: number): Promise<void> {
  const cacheKey = getIdCacheKey(id);
  await kv.delete(cacheKey);
}

/**
 * 使 Group 所有快取失效（包含模型名稱和 ID 索引）
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
 * 預熱快取（批次載入所有 Groups）
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
    // 查詢 GroupItems
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

    // 雙重索引快取
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
 * 清除所有 Group 快取
 */
export async function clearAllGroupCache(_kv: KVNamespace): Promise<void> {
  // Workers KV 不支援按前綴批次刪除，需要列出所有 key 再刪除
  // 由於這是昂貴的操作，建議使用 TTL 自動過期
  // 這裡提供一個佔位函數，實際使用時可以考慮其他方案

  console.warn('clearAllGroupCache: This operation is expensive and not recommended');
  // 如果真的需要清除，可以在更新 Group 時手動失效相關快取
}
