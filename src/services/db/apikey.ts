/**
 * APIKey 資料操作層
 * 對應原始 Go 專案的 internal/service/apikey.go
 *
 * 功能：
 * - APIKey CRUD 操作
 * - APIKey 驗證
 * - 配額與限制檢查
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { APIKey } from '@/types/apikey';

/**
 * 根據 Key 字串獲取 APIKey
 */
export async function getAPIKeyByKey(db: D1Database, key: string): Promise<APIKey | null> {
  const result = await db
    .prepare(
      `SELECT id, name, api_key, enabled, expire_at, max_cost, supported_models
       FROM api_keys
       WHERE api_key = ?`
    )
    .bind(key)
    .first<{
      id: number;
      name: string;
      api_key: string;
      enabled: number;
      expire_at: number;
      max_cost: number;
      supported_models: string;
    }>();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    name: result.name,
    apiKey: result.api_key,
    enabled: result.enabled === 1,
    expireAt: result.expire_at,
    maxCost: result.max_cost,
    supportedModels: result.supported_models,
  };
}

/**
 * 驗證 APIKey 是否有效
 * 返回 APIKey 物件或 null（如果無效）
 */
export async function validateAPIKey(db: D1Database, key: string): Promise<APIKey | null> {
  const apiKey = await getAPIKeyByKey(db, key);

  if (!apiKey) {
    return null;
  }

  // 檢查是否啟用
  if (!apiKey.enabled) {
    return null;
  }

  // 檢查是否過期（0 表示不過期）
  if (apiKey.expireAt > 0 && apiKey.expireAt < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return apiKey;
}

/**
 * 根據 ID 獲取 APIKey
 */
export async function getAPIKeyById(db: D1Database, id: number): Promise<APIKey | null> {
  const result = await db
    .prepare(
      `SELECT id, name, api_key, enabled, expire_at, max_cost, supported_models
       FROM api_keys
       WHERE id = ?`
    )
    .bind(id)
    .first<{
      id: number;
      name: string;
      api_key: string;
      enabled: number;
      expire_at: number;
      max_cost: number;
      supported_models: string;
    }>();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    name: result.name,
    apiKey: result.api_key,
    enabled: result.enabled === 1,
    expireAt: result.expire_at,
    maxCost: result.max_cost,
    supportedModels: result.supported_models,
  };
}

/**
 * 獲取所有 APIKeys
 */
export async function getAllAPIKeys(db: D1Database): Promise<APIKey[]> {
  const result = await db
    .prepare(
      `SELECT id, name, api_key, enabled, expire_at, max_cost, supported_models
       FROM api_keys
       ORDER BY id ASC`
    )
    .all<{
      id: number;
      name: string;
      api_key: string;
      enabled: number;
      expire_at: number;
      max_cost: number;
      supported_models: string;
    }>();

  return (result.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    enabled: row.enabled === 1,
    expireAt: row.expire_at,
    maxCost: row.max_cost,
    supportedModels: row.supported_models,
  }));
}

/**
 * 創建新的 APIKey
 */
export async function createAPIKey(db: D1Database, apiKey: Omit<APIKey, 'id'>): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO api_keys
       (name, api_key, enabled, expire_at, max_cost, supported_models)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      apiKey.name,
      apiKey.apiKey,
      apiKey.enabled ? 1 : 0,
      apiKey.expireAt,
      apiKey.maxCost,
      apiKey.supportedModels
    )
    .run();

  return result.meta.last_row_id as number;
}

/**
 * 更新 APIKey
 */
export async function updateAPIKey(db: D1Database, apiKey: APIKey): Promise<void> {
  await db
    .prepare(
      `UPDATE api_keys
       SET name = ?,
           api_key = ?,
           enabled = ?,
           expire_at = ?,
           max_cost = ?,
           supported_models = ?
       WHERE id = ?`
    )
    .bind(
      apiKey.name,
      apiKey.apiKey,
      apiKey.enabled ? 1 : 0,
      apiKey.expireAt,
      apiKey.maxCost,
      apiKey.supportedModels,
      apiKey.id
    )
    .run();
}

/**
 * 刪除 APIKey
 */
export async function deleteAPIKey(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM api_keys WHERE id = ?`).bind(id).run();
}
