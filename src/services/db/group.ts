/**
 * Group 資料操作層
 * 對應原始 Go 專案的 internal/service/group.go
 *
 * 功能：
 * - Group CRUD 操作
 * - GroupItem 關聯查詢
 * - 按模型名稱查詢（支援正則表達式匹配）
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Group, GroupItem } from '@/types/group';

/**
 * 根據模型名稱獲取 Group（包含 Items）
 * 支援完全匹配和正則表達式匹配
 */
export async function getGroupByModel(db: D1Database, modelName: string): Promise<Group | null> {
  // 1. 先嘗試完全匹配
  const exactMatch = await db
    .prepare(
      `SELECT id, name, mode, match_regex, first_token_timeout
       FROM groups
       WHERE name = ?
       LIMIT 1`
    )
    .bind(modelName)
    .first<{
      id: number;
      name: string;
      mode: number;
      match_regex: string;
      first_token_timeout: number;
    }>();

  if (exactMatch) {
    return await getGroupWithItems(db, exactMatch);
  }

  // 2. 嘗試正則表達式匹配
  const allGroups = await db
    .prepare(
      `SELECT id, name, mode, match_regex, first_token_timeout
       FROM groups
       WHERE match_regex IS NOT NULL AND match_regex != ''
       ORDER BY id ASC`
    )
    .all<{
      id: number;
      name: string;
      mode: number;
      match_regex: string;
      first_token_timeout: number;
    }>();

  for (const group of allGroups.results || []) {
    try {
      const regex = new RegExp(group.match_regex);
      if (regex.test(modelName)) {
        return await getGroupWithItems(db, group);
      }
    } catch (err) {
      console.error(`Invalid regex in group ${group.id}: ${group.match_regex}`, err);
    }
  }

  return null;
}

/**
 * 根據 ID 獲取 Group（包含 Items）
 */
export async function getGroupById(db: D1Database, id: number): Promise<Group | null> {
  const groupResult = await db
    .prepare(
      `SELECT id, name, mode, match_regex, first_token_timeout
       FROM groups
       WHERE id = ?`
    )
    .bind(id)
    .first<{
      id: number;
      name: string;
      mode: number;
      match_regex: string;
      first_token_timeout: number;
    }>();

  if (!groupResult) {
    return null;
  }

  return await getGroupWithItems(db, groupResult);
}

/**
 * 輔助函數：獲取 Group 並填充 Items
 */
async function getGroupWithItems(
  db: D1Database,
  groupData: {
    id: number;
    name: string;
    mode: number;
    match_regex: string;
    first_token_timeout: number;
  }
): Promise<Group> {
  // 查詢關聯的 GroupItems
  const itemsResult = await db
    .prepare(
      `SELECT id, group_id, channel_id, model_name, priority, weight
       FROM group_items
       WHERE group_id = ?
       ORDER BY priority ASC, id ASC`
    )
    .bind(groupData.id)
    .all<{
      id: number;
      group_id: number;
      channel_id: number;
      model_name: string;
      priority: number;
      weight: number;
    }>();

  const items: GroupItem[] = (itemsResult.results || []).map((item) => ({
    id: item.id,
    groupId: item.group_id,
    channelId: item.channel_id,
    modelName: item.model_name,
    priority: item.priority,
    weight: item.weight,
  }));

  return {
    id: groupData.id,
    name: groupData.name,
    mode: groupData.mode,
    matchRegex: groupData.match_regex,
    firstTokenTimeOut: groupData.first_token_timeout,
    items,
  };
}

/**
 * 獲取所有 Groups
 */
export async function getAllGroups(db: D1Database): Promise<Group[]> {
  const groupsResult = await db
    .prepare(
      `SELECT id, name, mode, match_regex, first_token_timeout
       FROM groups
       ORDER BY id ASC`
    )
    .all<{
      id: number;
      name: string;
      mode: number;
      match_regex: string;
      first_token_timeout: number;
    }>();

  const groups: Group[] = [];
  for (const groupData of groupsResult.results || []) {
    const group = await getGroupWithItems(db, groupData);
    groups.push(group);
  }

  return groups;
}

/**
 * 創建新的 Group
 */

export async function listGroups(db: D1Database): Promise<Group[]> {
  return getAllGroups(db);
}

export async function getGroup(db: D1Database, id: number): Promise<Group | null> {
  return getGroupById(db, id);
}

export async function createGroup(db: D1Database, data: any): Promise<number> {
  const result = await db
    .prepare('INSERT INTO groups (name, model, mode, enabled) VALUES (?, ?, ?, ?)')
    .bind(data.name, data.model, data.mode, data.enabled ? 1 : 0)
    .run();
  return result.meta.last_row_id as number;
}

export async function updateGroup(db: D1Database, id: number, updates: any): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.name) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.model) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.mode !== undefined) {
    fields.push('mode = ?');
    values.push(updates.mode);
  }
  if (updates.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(updates.enabled ? 1 : 0);
  }
  if (fields.length > 0) {
    values.push(id);
    await db
      .prepare(`UPDATE groups SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }
}

export async function deleteGroup(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM group_items WHERE group_id = ?').bind(id).run();
  await db.prepare('DELETE FROM groups WHERE id = ?').bind(id).run();
}
