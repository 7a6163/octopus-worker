/**
 * Settings data access layer
 * Corresponds to internal/service/settings.go in the original Go project
 *
 * Features:
 * - Settings CRUD operations
 * - Batch settings updates
 * - Settings cache support
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Setting } from '@/types/setting';

/**
 * Get a setting value by key
 */
export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const result = await db
    .prepare(
      `SELECT value
       FROM settings
       WHERE key = ?`
    )
    .bind(key)
    .first<{ value: string }>();

  return result?.value || null;
}

/**
 * Get a setting object by key
 */
export async function getSettingObject(db: D1Database, key: string): Promise<Setting | null> {
  const result = await db
    .prepare(
      `SELECT key, value
       FROM settings
       WHERE key = ?`
    )
    .bind(key)
    .first<{
      key: string;
      value: string;
    }>();

  if (!result) {
    return null;
  }

  return {
    key: result.key,
    value: result.value,
  };
}

/**
 * Get all settings
 */
export async function getAllSettings(db: D1Database): Promise<Setting[]> {
  const result = await db
    .prepare(
      `SELECT key, value
       FROM settings
       ORDER BY key ASC`
    )
    .all<{
      key: string;
      value: string;
    }>();

  return (result.results || []).map((row) => ({
    key: row.key,
    value: row.value,
  }));
}

/**
 * Get all settings (returned as a Map)
 */
export async function getAllSettingsAsMap(db: D1Database): Promise<Map<string, string>> {
  const settings = await getAllSettings(db);
  const map = new Map<string, string>();

  for (const setting of settings) {
    map.set(setting.key, setting.value);
  }

  return map;
}

/**
 * Update a single setting value
 */
export async function updateSetting(db: D1Database, key: string, value: string): Promise<void> {
  // SQLite UPSERT syntax
  await db
    .prepare(
      `INSERT INTO settings (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .bind(key, value)
    .run();
}

/**
 * Batch update settings
 */
export async function updateSettings(
  db: D1Database,
  settings: Record<string, string>
): Promise<void> {
  // Batch update using a transaction
  const statements: D1PreparedStatement[] = [];

  for (const [key, value] of Object.entries(settings)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO settings (key, value)
           VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .bind(key, value)
    );
  }

  // D1 batch execution
  await db.batch(statements);
}

/**
 * Create a new setting
 */
export async function createSetting(db: D1Database, setting: Setting): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value)
       VALUES (?, ?)`
    )
    .bind(setting.key, setting.value)
    .run();
}

/**
 * Delete a setting
 */
export async function deleteSetting(db: D1Database, key: string): Promise<void> {
  await db.prepare(`DELETE FROM settings WHERE key = ?`).bind(key).run();
}

/**
 * Get a boolean setting
 */
export async function getBooleanSetting(
  db: D1Database,
  key: string,
  defaultValue = false
): Promise<boolean> {
  const value = await getSetting(db, key);
  if (!value) return defaultValue;

  return value === 'true' || value === '1';
}

/**
 * Get a numeric setting
 */
export async function getNumberSetting(
  db: D1Database,
  key: string,
  defaultValue = 0
): Promise<number> {
  const value = await getSetting(db, key);
  if (!value) return defaultValue;

  const num = parseInt(value, 10);
  return Number.isNaN(num) ? defaultValue : num;
}
