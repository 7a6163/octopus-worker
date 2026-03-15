/**
 * APIKey data access layer
 * Corresponds to internal/service/apikey.go in the original Go project
 *
 * Features:
 * - APIKey CRUD operations
 * - APIKey validation
 * - Quota and limit checks
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { APIKey } from '@/types/apikey';

/**
 * Get an APIKey by key string
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
 * Validate whether an APIKey is valid
 * Returns the APIKey object, or null if invalid
 */
export async function validateAPIKey(db: D1Database, key: string): Promise<APIKey | null> {
  const apiKey = await getAPIKeyByKey(db, key);

  if (!apiKey) {
    return null;
  }

  // Check if enabled
  if (!apiKey.enabled) {
    return null;
  }

  // Check if expired (0 means no expiration)
  if (apiKey.expireAt > 0 && apiKey.expireAt < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return apiKey;
}

/**
 * Get an APIKey by ID
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
 * Get all APIKeys
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
 * Create a new APIKey
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
 * Update an APIKey
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
 * Delete an APIKey
 */
export async function deleteAPIKey(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM api_keys WHERE id = ?`).bind(id).run();
}
