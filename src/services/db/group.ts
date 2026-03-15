/**
 * Group data access layer
 * Corresponds to internal/service/group.go in the original Go project
 *
 * Features:
 * - Group CRUD operations
 * - GroupItem association queries
 * - Query by model name (with regex matching support)
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Group, GroupItem } from '@/types/group';

/**
 * Get a Group by model name (including Items)
 * Supports exact match and regex matching
 */
export async function getGroupByModel(db: D1Database, modelName: string): Promise<Group | null> {
  // 1. Try exact match first
  const exactMatch = await db
    .prepare(
      `SELECT id, name, mode, match_regex, first_token_time_out
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
      first_token_time_out: number;
    }>();

  if (exactMatch) {
    return await getGroupWithItems(db, exactMatch);
  }

  // 2. Try regex matching
  const allGroups = await db
    .prepare(
      `SELECT id, name, mode, match_regex, first_token_time_out
       FROM groups
       WHERE match_regex IS NOT NULL AND match_regex != ''
       ORDER BY id ASC`
    )
    .all<{
      id: number;
      name: string;
      mode: number;
      match_regex: string;
      first_token_time_out: number;
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
 * Get a Group by ID (including Items)
 */
export async function getGroupById(db: D1Database, id: number): Promise<Group | null> {
  const groupResult = await db
    .prepare(
      `SELECT id, name, mode, match_regex, first_token_time_out
       FROM groups
       WHERE id = ?`
    )
    .bind(id)
    .first<{
      id: number;
      name: string;
      mode: number;
      match_regex: string;
      first_token_time_out: number;
    }>();

  if (!groupResult) {
    return null;
  }

  return await getGroupWithItems(db, groupResult);
}

/**
 * Helper: fetch a Group and populate its Items
 */
async function getGroupWithItems(
  db: D1Database,
  groupData: {
    id: number;
    name: string;
    mode: number;
    match_regex: string;
    first_token_time_out: number;
  }
): Promise<Group> {
  // Query associated GroupItems
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
    firstTokenTimeOut: groupData.first_token_time_out,
    items,
  };
}

/**
 * Get all Groups
 */
export async function getAllGroups(db: D1Database): Promise<Group[]> {
  const groupsResult = await db
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

  const groups: Group[] = [];
  for (const groupData of groupsResult.results || []) {
    const group = await getGroupWithItems(db, groupData);
    groups.push(group);
  }

  return groups;
}

/**
 * Create a new Group
 */

export async function listGroups(db: D1Database): Promise<Group[]> {
  return getAllGroups(db);
}

export async function getGroup(db: D1Database, id: number): Promise<Group | null> {
  return getGroupById(db, id);
}

export async function createGroup(
  db: D1Database,
  data: {
    name: string;
    mode: number;
    match_regex?: string;
    first_token_time_out?: number;
  }
): Promise<number> {
  const result = await db
    .prepare(
      'INSERT INTO groups (name, mode, match_regex, first_token_time_out) VALUES (?, ?, ?, ?)'
    )
    .bind(data.name, data.mode, data.match_regex ?? '', data.first_token_time_out ?? 0)
    .run();
  return result.meta.last_row_id as number;
}

export async function updateGroup(
  db: D1Database,
  id: number,
  updates: {
    name?: string;
    mode?: number;
    match_regex?: string;
    first_token_time_out?: number;
  }
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  const fieldMap: Record<string, (v: unknown) => unknown> = {
    name: (v) => v,
    mode: (v) => v,
    match_regex: (v) => v,
    first_token_time_out: (v) => v,
  };

  for (const [key, transform] of Object.entries(fieldMap)) {
    const val = updates[key as keyof typeof updates];
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(transform(val));
    }
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
