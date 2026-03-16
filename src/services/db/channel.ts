/**
 * Channel data access layer
 * Corresponds to internal/service/channel.go in the original Go project
 *
 * Features:
 * - Channel CRUD operations
 * - ChannelKey association queries
 * - Batch query support
 */

import type { D1Database, D1Result } from '@cloudflare/workers-types';
import type { Channel, ChannelKey } from '@/types/channel';

/**
 * Get a Channel by ID (including Keys)
 */
export async function getChannel(db: D1Database, id: number): Promise<Channel | null> {
  // Query the Channel
  const channelResult = await db
    .prepare(
      `SELECT id, name, type, enabled, base_urls, model, custom_model,
              proxy, auto_sync, auto_group, match_regex, custom_header
       FROM channels
       WHERE id = ?`
    )
    .bind(id)
    .first<{
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
      match_regex: string;
      custom_header: string;
    }>();

  if (!channelResult) {
    return null;
  }

  // Query associated ChannelKeys
  const keysResult = await db
    .prepare(
      `SELECT id, channel_id, enabled, channel_key, status_code,
              last_use_time_stamp, total_cost, remark
       FROM channel_keys
       WHERE channel_id = ? AND enabled = 1
       ORDER BY total_cost ASC`
    )
    .bind(id)
    .all<{
      id: number;
      channel_id: number;
      enabled: number;
      channel_key: string;
      status_code: number;
      last_use_time_stamp: number;
      total_cost: number;
      remark: string;
    }>();

  const keys: ChannelKey[] = (keysResult.results || []).map((key) => ({
    id: key.id,
    channelId: key.channel_id,
    enabled: key.enabled === 1,
    channelKey: key.channel_key,
    statusCode: key.status_code,
    lastUseTimeStamp: key.last_use_time_stamp,
    totalCost: key.total_cost,
    remark: key.remark,
  }));

  // Assemble the Channel
  const channel: Channel = {
    id: channelResult.id,
    name: channelResult.name,
    type: channelResult.type,
    enabled: channelResult.enabled === 1,
    baseUrls: JSON.parse(channelResult.base_urls),
    keys,
    model: channelResult.model,
    customModel: channelResult.custom_model,
    proxy: channelResult.proxy === 1,
    autoSync: channelResult.auto_sync === 1,
    autoGroup: channelResult.auto_group,
    matchRegex: channelResult.match_regex,
    customHeader: JSON.parse(channelResult.custom_header),
  };

  return channel;
}

/**
 * Batch fetch Channels (including Keys)
 */
export async function getChannelsByIds(
  db: D1Database,
  ids: number[]
): Promise<Map<number, Channel>> {
  if (ids.length === 0) {
    return new Map();
  }

  const placeholders = ids.map(() => '?').join(',');

  // Batch query Channels
  const channelsResult = await db
    .prepare(
      `SELECT id, name, type, enabled, base_urls, model, custom_model,
              proxy, auto_sync, auto_group, match_regex, custom_header
       FROM channels
       WHERE id IN (${placeholders})`
    )
    .bind(...ids)
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
      match_regex: string;
      custom_header: string;
    }>();

  // Batch query ChannelKeys
  const keysResult = await db
    .prepare(
      `SELECT id, channel_id, enabled, channel_key, status_code,
              last_use_time_stamp, total_cost, remark
       FROM channel_keys
       WHERE channel_id IN (${placeholders}) AND enabled = 1
       ORDER BY channel_id ASC, total_cost ASC`
    )
    .bind(...ids)
    .all<{
      id: number;
      channel_id: number;
      enabled: number;
      channel_key: string;
      status_code: number;
      last_use_time_stamp: number;
      total_cost: number;
      remark: string;
    }>();

  // Assemble ChannelKeys Map
  const keysMap = new Map<number, ChannelKey[]>();
  for (const key of keysResult.results || []) {
    if (!keysMap.has(key.channel_id)) {
      keysMap.set(key.channel_id, []);
    }
    keysMap.get(key.channel_id)?.push({
      id: key.id,
      channelId: key.channel_id,
      enabled: key.enabled === 1,
      channelKey: key.channel_key,
      statusCode: key.status_code,
      lastUseTimeStamp: key.last_use_time_stamp,
      totalCost: key.total_cost,
      remark: key.remark,
    });
  }

  // Assemble Channels Map
  const channelsMap = new Map<number, Channel>();
  for (const ch of channelsResult.results || []) {
    channelsMap.set(ch.id, {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      enabled: ch.enabled === 1,
      baseUrls: JSON.parse(ch.base_urls),
      keys: keysMap.get(ch.id) || [],
      model: ch.model,
      customModel: ch.custom_model,
      proxy: ch.proxy === 1,
      autoSync: ch.auto_sync === 1,
      autoGroup: ch.auto_group,
      matchRegex: ch.match_regex,
      customHeader: JSON.parse(ch.custom_header),
    });
  }

  return channelsMap;
}

/**
 * Get all enabled Channels
 */
export async function getAllChannels(db: D1Database): Promise<Channel[]> {
  // Query all enabled Channels
  const channelsResult = await db
    .prepare(
      `SELECT id, name, type, enabled, base_urls, model, custom_model,
              proxy, auto_sync, auto_group, match_regex, custom_header
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
      match_regex: string;
      custom_header: string;
    }>();

  const channelIds = channelsResult.results?.map((ch) => ch.id) || [];
  if (channelIds.length === 0) {
    return [];
  }

  // Batch fetch Keys
  const channelsMap = await getChannelsByIds(db, channelIds);

  // Convert to array
  return Array.from(channelsMap.values());
}

/**
 * Update ChannelKey status
 */
export async function updateChannelKeyStatus(
  db: D1Database,
  keyId: number,
  statusCode: number,
  costDelta: number
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `UPDATE channel_keys
       SET status_code = ?,
           last_use_time_stamp = ?,
           total_cost = total_cost + ?
       WHERE id = ?`
    )
    .bind(statusCode, nowSec, costDelta, keyId)
    .run();
}

export async function listChannels(db: D1Database): Promise<Channel[]> {
  const channelsResult = await db
    .prepare(
      `SELECT id, name, type, enabled, base_urls, model, custom_model,
              proxy, auto_sync, auto_group, match_regex, custom_header
       FROM channels
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
      match_regex: string;
      custom_header: string;
    }>();

  const channelIds = channelsResult.results?.map((ch) => ch.id) || [];
  if (channelIds.length === 0) {
    return [];
  }

  const channelsMap = await getChannelsByIds(db, channelIds);
  return Array.from(channelsMap.values());
}

export async function createChannel(
  db: D1Database,
  data: {
    name: string;
    type: number;
    enabled: boolean;
    base_urls: { url: string; delay: number }[];
    model: string;
    custom_model: string;
    proxy: boolean;
    auto_sync: boolean;
    auto_group: number;
    match_regex: string;
    custom_header: { headerKey: string; headerValue: string }[];
    keys_to_add: { enabled: boolean; channel_key: string; remark: string }[];
  }
): Promise<number> {
  const statements = [];

  statements.push(
    db
      .prepare(
        `INSERT INTO channels (name, type, enabled, base_urls, model, custom_model, proxy, auto_sync, auto_group, match_regex, custom_header)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        data.name,
        data.type,
        data.enabled ? 1 : 0,
        JSON.stringify(data.base_urls),
        data.model,
        data.custom_model,
        data.proxy ? 1 : 0,
        data.auto_sync ? 1 : 0,
        data.auto_group,
        data.match_regex,
        JSON.stringify(data.custom_header)
      )
  );

  const results = await db.batch(statements);
  const channelId = (results[0] as D1Result).meta.last_row_id as number;

  // Insert channel keys
  if (data.keys_to_add.length > 0) {
    const keyStatements = data.keys_to_add.map((key) =>
      db
        .prepare(
          'INSERT INTO channel_keys (channel_id, enabled, channel_key, remark) VALUES (?, ?, ?, ?)'
        )
        .bind(channelId, key.enabled ? 1 : 0, key.channel_key, key.remark)
    );
    await db.batch(keyStatements);
  }

  return channelId;
}

interface ChannelUpdate {
  name?: string;
  type?: number;
  enabled?: boolean;
  base_urls?: { url: string; delay: number }[];
  model?: string;
  custom_model?: string;
  proxy?: boolean;
  auto_sync?: boolean;
  auto_group?: number;
  match_regex?: string;
  custom_header?: { headerKey: string; headerValue: string }[];
}

export async function updateChannel(
  db: D1Database,
  id: number,
  updates: ChannelUpdate
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  const fieldMap: Record<string, (v: unknown) => unknown> = {
    name: (v) => v,
    type: (v) => v,
    enabled: (v) => (v ? 1 : 0),
    base_urls: (v) => JSON.stringify(v),
    model: (v) => v,
    custom_model: (v) => v,
    proxy: (v) => (v ? 1 : 0),
    auto_sync: (v) => (v ? 1 : 0),
    auto_group: (v) => v,
    match_regex: (v) => v,
    custom_header: (v) => JSON.stringify(v),
  };

  for (const [key, transform] of Object.entries(fieldMap)) {
    const val = updates[key as keyof ChannelUpdate];
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(transform(val));
    }
  }

  if (fields.length > 0) {
    values.push(id);
    await db
      .prepare(`UPDATE channels SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }
}

export async function deleteChannel(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM group_items WHERE channel_id = ?').bind(id),
    db.prepare('DELETE FROM channel_keys WHERE channel_id = ?').bind(id),
    db.prepare('DELETE FROM channels WHERE id = ?').bind(id),
  ]);
}
