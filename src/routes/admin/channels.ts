/**
 * Channels 管理 API
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { invalidateChannelCache } from '@/services/cache/channel';
import {
  createChannel,
  deleteChannel,
  getChannel,
  listChannels,
  updateChannel,
} from '@/services/db/channel';
import { fetchModelsFromUpstream, syncChannelModels } from '@/services/sync/channel-sync';
import type { Bindings, Variables } from '@/types';

const channels = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Validation schemas
const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().min(1).max(50),
  baseUrl: z.string().url(),
  enabled: z.boolean().default(true),
  maxRetries: z.number().int().min(0).default(3),
  timeout: z.number().int().min(1000).default(30000),
});

const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.string().min(1).max(50).optional(),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).optional(),
  timeout: z.number().int().min(1000).optional(),
});

/**
 * GET /api/v1/admin/channels
 * 列出所有 channels
 */
channels.get('/', async (c) => {
  try {
    const channelList = await listChannels(c.env.DB);
    return c.json({
      code: 200,
      data: channelList,
    });
  } catch (err) {
    console.error('Failed to list channels:', err);
    return c.json(
      {
        code: 500,
        message: '獲取 channels 列表失敗',
      },
      500
    );
  }
});

/**
 * GET /api/v1/admin/channels/:id
 * 獲取指定 channel
 */
channels.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: '無效的 channel ID' }, 400);
  }

  try {
    const channel = await getChannel(c.env.DB, id);
    if (!channel) {
      return c.json({ code: 404, message: 'Channel 不存在' }, 404);
    }
    return c.json({
      code: 200,
      data: channel,
    });
  } catch (err) {
    console.error('Failed to get channel:', err);
    return c.json({ code: 500, message: '獲取 channel 失敗' }, 500);
  }
});

/**
 * POST /api/v1/admin/channels
 * 創建新 channel
 */
channels.post('/', zValidator('json', createChannelSchema), async (c) => {
  const body = c.req.valid('json');

  try {
    const channelId = await createChannel(c.env.DB, {
      name: body.name,
      type: body.type as any, // Type will be validated by zod
      baseUrl: body.baseUrl,
      enabled: body.enabled,
      maxRetries: body.maxRetries,
      timeout: body.timeout,
    });

    return c.json({
      code: 200,
      message: 'Channel 創建成功',
      data: { id: channelId },
    });
  } catch (err) {
    console.error('Failed to create channel:', err);
    return c.json({ code: 500, message: '創建 channel 失敗' }, 500);
  }
});

/**
 * PUT /api/v1/admin/channels/:id
 * 更新 channel
 */
channels.put('/:id', zValidator('json', updateChannelSchema), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: '無效的 channel ID' }, 400);
  }

  const body = c.req.valid('json');

  try {
    // 檢查 channel 是否存在
    const existing = await getChannel(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'Channel 不存在' }, 404);
    }

    await updateChannel(c.env.DB, id, body);

    // 清除快取
    await invalidateChannelCache(c.env.CACHE, id);

    return c.json({
      code: 200,
      message: 'Channel 更新成功',
    });
  } catch (err) {
    console.error('Failed to update channel:', err);
    return c.json({ code: 500, message: '更新 channel 失敗' }, 500);
  }
});

/**
 * DELETE /api/v1/admin/channels/:id
 * 刪除 channel
 */
channels.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: '無效的 channel ID' }, 400);
  }

  try {
    // 檢查 channel 是否存在
    const existing = await getChannel(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'Channel 不存在' }, 404);
    }

    await deleteChannel(c.env.DB, id);

    // 清除快取
    await invalidateChannelCache(c.env.CACHE, id);

    return c.json({
      code: 200,
      message: 'Channel 刪除成功',
    });
  } catch (err) {
    console.error('Failed to delete channel:', err);
    return c.json({ code: 500, message: '刪除 channel 失敗' }, 500);
  }
});

/**
 * POST /api/v1/admin/channels/fetch-model
 * 測試從上游獲取模型列表
 */
channels.post('/fetch-model', async (c) => {
  try {
    const body = await c.req.json<{ type: number; base_url: string; key: string }>();

    if (body.base_url === undefined || body.key === undefined || body.type === undefined) {
      return c.json({ code: 400, message: 'type, base_url, and key are required' }, 400);
    }

    // SSRF protection: only allow http/https and reject private/loopback addresses
    try {
      const parsed = new URL(body.base_url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return c.json({ code: 400, message: 'Only http/https URLs are allowed' }, 400);
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '0.0.0.0' ||
        host.startsWith('10.') ||
        host.startsWith('172.') ||
        host.startsWith('192.168.') ||
        host.endsWith('.internal') ||
        host.endsWith('.local')
      ) {
        return c.json({ code: 400, message: 'Private/internal URLs are not allowed' }, 400);
      }
    } catch {
      return c.json({ code: 400, message: 'Invalid URL' }, 400);
    }

    const models = await fetchModelsFromUpstream(body.base_url, body.key, body.type, []);
    return c.json({
      code: 200,
      data: { models: [...models] },
    });
  } catch (err) {
    console.error('Failed to fetch models from upstream:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch models';
    return c.json({ code: 500, message }, 500);
  }
});

/**
 * POST /api/v1/admin/channels/sync
 * 手動觸發 channel 模型同步
 */
channels.post('/sync', async (c) => {
  try {
    await syncChannelModels(c.env);
    return c.json({ code: 200, message: 'sync triggered' });
  } catch (err) {
    console.error('Failed to sync channel models:', err);
    return c.json({ code: 500, message: 'Failed to sync channel models' }, 500);
  }
});

export default channels;
