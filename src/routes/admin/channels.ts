/**
 * Channels 管理 API
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Bindings, Variables } from '@/types';
import {
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
} from '@/services/db/channel';
import { invalidateChannelCache } from '@/services/cache/channel';

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
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
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
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
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
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
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

export default channels;
