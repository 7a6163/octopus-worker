/**
 * Settings 資料操作層
 * 對應原始 Go 專案的 internal/service/settings.go
 *
 * 功能：
 * - Settings CRUD 操作
 * - 批次更新設定
 * - 設定快取支援
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Setting } from '@/types/setting';

/**
 * 根據 Key 獲取設定值
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
 * 根據 Key 獲取設定物件
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
 * 獲取所有設定
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
 * 獲取所有設定（以 Map 形式返回）
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
 * 更新單一設定值
 */
export async function updateSetting(db: D1Database, key: string, value: string): Promise<void> {
  // SQLite UPSERT 語法
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
 * 批次更新設定
 */
export async function updateSettings(
  db: D1Database,
  settings: Record<string, string>
): Promise<void> {
  // 使用事務批次更新
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

  // D1 批次執行
  await db.batch(statements);
}

/**
 * 創建新設定
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
 * 刪除設定
 */
export async function deleteSetting(db: D1Database, key: string): Promise<void> {
  await db.prepare(`DELETE FROM settings WHERE key = ?`).bind(key).run();
}

/**
 * 獲取布林值設定
 */
export async function getBooleanSetting(db: D1Database, key: string, defaultValue = false): Promise<boolean> {
  const value = await getSetting(db, key);
  if (!value) return defaultValue;

  return value === 'true' || value === '1';
}

/**
 * 獲取數字設定
 */
export async function getNumberSetting(db: D1Database, key: string, defaultValue = 0): Promise<number> {
  const value = await getSetting(db, key);
  if (!value) return defaultValue;

  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}
