/**
 * Channel 資料操作層
 * 對應原始 Go 專案的 internal/service/channel.go
 *
 * 功能：
 * - Channel CRUD 操作
 * - ChannelKey 關聯查詢
 * - 支援批次查詢
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Channel, ChannelKey } from '@/types/channel';

/**
 * 根據 ID 獲取 Channel（包含 Keys）
 */
export async function getChannel(db: D1Database, id: number): Promise<Channel | null> {
  // 查詢 Channel
  const channelResult = await db
    .prepare(
      `SELECT id, name, type, enabled, base_urls, model, custom_model,
              proxy, auto_sync, auto_group, custom_header
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
      custom_header: string;
    }>();

  if (!channelResult) {
    return null;
  }

  // 查詢關聯的 ChannelKeys
  const keysResult = await db
    .prepare(
      `SELECT id, channel_id, enabled, channel_key, status_code,
              last_use_timestamp, total_cost, remark
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
      last_use_timestamp: number;
      total_cost: number;
      remark: string;
    }>();

  const keys: ChannelKey[] = (keysResult.results || []).map((key) => ({
    id: key.id,
    channelId: key.channel_id,
    enabled: key.enabled === 1,
    channelKey: key.channel_key,
    statusCode: key.status_code,
    lastUseTimeStamp: key.last_use_timestamp,
    totalCost: key.total_cost,
    remark: key.remark,
  }));

  // 組裝 Channel
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
    customHeader: JSON.parse(channelResult.custom_header),
  };

  return channel;
}

/**
 * 批次獲取 Channels（包含 Keys）
 */
export async function getChannelsByIds(
  db: D1Database,
  ids: number[]
): Promise<Map<number, Channel>> {
  if (ids.length === 0) {
    return new Map();
  }

  const placeholders = ids.map(() => '?').join(',');

  // 批次查詢 Channels
  const channelsResult = await db
    .prepare(
      `SELECT id, name, type, enabled, base_urls, model, custom_model,
              proxy, auto_sync, auto_group, custom_header
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
      custom_header: string;
    }>();

  // 批次查詢 ChannelKeys
  const keysResult = await db
    .prepare(
      `SELECT id, channel_id, enabled, channel_key, status_code,
              last_use_timestamp, total_cost, remark
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
      last_use_timestamp: number;
      total_cost: number;
      remark: string;
    }>();

  // 組裝 ChannelKeys Map
  const keysMap = new Map<number, ChannelKey[]>();
  for (const key of keysResult.results || []) {
    if (!keysMap.has(key.channel_id)) {
      keysMap.set(key.channel_id, []);
    }
    keysMap.get(key.channel_id)!.push({
      id: key.id,
      channelId: key.channel_id,
      enabled: key.enabled === 1,
      channelKey: key.channel_key,
      statusCode: key.status_code,
      lastUseTimeStamp: key.last_use_timestamp,
      totalCost: key.total_cost,
      remark: key.remark,
    });
  }

  // 組裝 Channels Map
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
      customHeader: JSON.parse(ch.custom_header),
    });
  }

  return channelsMap;
}

/**
 * 獲取所有啟用的 Channels
 */
export async function getAllChannels(db: D1Database): Promise<Channel[]> {
  // 查詢所有啟用的 Channels
  const channelsResult = await db
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

  const channelIds = channelsResult.results?.map((ch) => ch.id) || [];
  if (channelIds.length === 0) {
    return [];
  }

  // 批次獲取 Keys
  const channelsMap = await getChannelsByIds(db, channelIds);

  // 轉換為陣列
  return Array.from(channelsMap.values());
}

/**
 * 更新 ChannelKey 狀態
 */
export async function updateChannelKeyStatus(
  db: D1Database,
  keyId: number,
  statusCode: number,
  totalCost: number
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `UPDATE channel_keys
       SET status_code = ?,
           last_use_timestamp = ?,
           total_cost = ?
       WHERE id = ?`
    )
    .bind(statusCode, nowSec, totalCost, keyId)
    .run();
}

export async function listChannels(db: D1Database): Promise<Channel[]> {
  return getAllChannels(db);
}

export async function createChannel(
  db: D1Database,
  data: { name: string; type: string; baseUrl: string; enabled: boolean; maxRetries: number; timeout: number }
): Promise<number> {
  const result = await db
    .prepare('INSERT INTO channels (name, type, enabled, base_urls, max_retries, timeout) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(data.name, data.type, data.enabled ? 1 : 0, JSON.stringify([{ url: data.baseUrl, delay: 0 }]), data.maxRetries, data.timeout)
    .run();
  return result.meta.last_row_id as number;
}

export async function updateChannel(db: D1Database, id: number, updates: any): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.name) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.type) { fields.push('type = ?'); values.push(updates.type); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
  if (updates.maxRetries) { fields.push('max_retries = ?'); values.push(updates.maxRetries); }
  if (updates.timeout) { fields.push('timeout = ?'); values.push(updates.timeout); }
  if (updates.baseUrl) { fields.push('base_urls = ?'); values.push(JSON.stringify([{ url: updates.baseUrl, delay: 0 }])); }
  if (fields.length > 0) {
    values.push(id);
    await db.prepare('UPDATE channels SET ' + fields.join(', ') + ' WHERE id = ?').bind(...values).run();
  }
}

export async function deleteChannel(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM group_items WHERE channel_id = ?').bind(id),
    db.prepare('DELETE FROM channel_keys WHERE channel_id = ?').bind(id),
    db.prepare('DELETE FROM channels WHERE id = ?').bind(id),
  ]);
}
