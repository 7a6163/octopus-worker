/**
 * Channels management API
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
import type { ChannelKey } from '@/types/channel';
import { validateOutboundUrl } from '@/utils/url-validation';

/**
 * Mask a channel key, showing only the first 8 characters.
 */
function maskChannelKey(key: ChannelKey): ChannelKey {
  return {
    ...key,
    channelKey: key.channelKey.length > 8 ? `${key.channelKey.slice(0, 8)}...` : '***',
  };
}

const channels = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Validation schemas
const baseUrlSchema = z.object({
  url: z.string().min(1),
  delay: z.number().default(0),
});

const keyEntrySchema = z.object({
  enabled: z.boolean().default(true),
  channel_key: z.string().min(1),
  remark: z.string().default(''),
});

const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.number().int().min(0).max(5),
  enabled: z.boolean().default(true),
  base_urls: z.array(baseUrlSchema).min(1),
  model: z.string().default(''),
  custom_model: z.string().default(''),
  proxy: z.boolean().default(false),
  auto_sync: z.boolean().default(false),
  auto_group: z.number().int().min(0).max(3).default(0),
  match_regex: z.string().default(''),
  custom_header: z.array(z.object({ headerKey: z.string(), headerValue: z.string() })).default([]),
  keys_to_add: z.array(keyEntrySchema).default([]),
});

const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.number().int().min(0).max(5).optional(),
  enabled: z.boolean().optional(),
  base_urls: z.array(baseUrlSchema).optional(),
  model: z.string().optional(),
  custom_model: z.string().optional(),
  proxy: z.boolean().optional(),
  auto_sync: z.boolean().optional(),
  auto_group: z.number().int().min(0).max(3).optional(),
  match_regex: z.string().optional(),
  custom_header: z.array(z.object({ headerKey: z.string(), headerValue: z.string() })).optional(),
});

/**
 * GET /api/v1/admin/channels
 * List all channels
 */
channels.get('/', async (c) => {
  try {
    const channelList = await listChannels(c.env.DB);
    const maskedList = channelList.map((ch) => ({
      ...ch,
      keys: ch.keys.map(maskChannelKey),
    }));
    return c.json({
      code: 200,
      data: maskedList,
    });
  } catch (err) {
    console.error('Failed to list channels:', err);
    return c.json(
      {
        code: 500,
        message: 'Failed to list channels',
      },
      500
    );
  }
});

/**
 * GET /api/v1/admin/channels/:id
 * Get a specific channel
 */
channels.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid channel ID' }, 400);
  }

  try {
    const channel = await getChannel(c.env.DB, id);
    if (!channel) {
      return c.json({ code: 404, message: 'Channel not found' }, 404);
    }
    const maskedChannel = {
      ...channel,
      keys: channel.keys.map(maskChannelKey),
    };
    return c.json({
      code: 200,
      data: maskedChannel,
    });
  } catch (err) {
    console.error('Failed to get channel:', err);
    return c.json({ code: 500, message: 'Failed to get channel' }, 500);
  }
});

/**
 * POST /api/v1/admin/channels
 * Create a new channel
 */
channels.post('/', zValidator('json', createChannelSchema), async (c) => {
  const body = c.req.valid('json');

  try {
    const channelId = await createChannel(c.env.DB, {
      name: body.name,
      type: body.type,
      enabled: body.enabled,
      base_urls: body.base_urls,
      model: body.model,
      custom_model: body.custom_model,
      proxy: body.proxy,
      auto_sync: body.auto_sync,
      auto_group: body.auto_group,
      match_regex: body.match_regex,
      custom_header: body.custom_header,
      keys_to_add: body.keys_to_add,
    });

    return c.json({
      code: 200,
      message: 'Channel created successfully',
      data: { id: channelId },
    });
  } catch (err) {
    console.error('Failed to create channel:', err);
    return c.json({ code: 500, message: 'Failed to create channel' }, 500);
  }
});

/**
 * PUT /api/v1/admin/channels/:id
 * Update a channel
 */
channels.put('/:id', zValidator('json', updateChannelSchema), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid channel ID' }, 400);
  }

  const body = c.req.valid('json');

  try {
    // Check if channel exists
    const existing = await getChannel(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'Channel not found' }, 404);
    }

    await updateChannel(c.env.DB, id, {
      name: body.name,
      type: body.type,
      enabled: body.enabled,
      base_urls: body.base_urls,
      model: body.model,
      custom_model: body.custom_model,
      proxy: body.proxy,
      auto_sync: body.auto_sync,
      auto_group: body.auto_group,
      match_regex: body.match_regex,
      custom_header: body.custom_header,
    });

    // Invalidate cache
    await invalidateChannelCache(c.env.CACHE, id);

    return c.json({
      code: 200,
      message: 'Channel updated successfully',
    });
  } catch (err) {
    console.error('Failed to update channel:', err);
    return c.json({ code: 500, message: 'Failed to update channel' }, 500);
  }
});

/**
 * DELETE /api/v1/admin/channels/:id
 * Delete a channel
 */
channels.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid channel ID' }, 400);
  }

  try {
    // Check if channel exists
    const existing = await getChannel(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'Channel not found' }, 404);
    }

    await deleteChannel(c.env.DB, id);

    // Invalidate cache
    await invalidateChannelCache(c.env.CACHE, id);

    return c.json({
      code: 200,
      message: 'Channel deleted successfully',
    });
  } catch (err) {
    console.error('Failed to delete channel:', err);
    return c.json({ code: 500, message: 'Failed to delete channel' }, 500);
  }
});

/**
 * POST /api/v1/admin/channels/fetch-model
 * Test fetching model list from upstream
 */
channels.post('/fetch-model', async (c) => {
  try {
    const body = await c.req.json<{ type: number; base_url: string; key: string }>();

    if (body.base_url === undefined || body.key === undefined || body.type === undefined) {
      return c.json({ code: 400, message: 'type, base_url, and key are required' }, 400);
    }

    // SSRF protection: only allow http/https and reject private/loopback addresses
    const urlCheck = validateOutboundUrl(body.base_url);
    if (!urlCheck.valid) {
      return c.json({ code: 400, message: urlCheck.error ?? 'Invalid URL' }, 400);
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
 * Manually trigger channel model sync
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
