/**
 * API Keys management API
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { invalidateAPIKeyCache } from '@/services/cache/apikey';
import { createAPIKey, deleteAPIKey, getAllAPIKeys, getAPIKeyById } from '@/services/db/apikey';
import type { Bindings, Variables } from '@/types';

const apikeys = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * Generate a random API key
 */
function generateAPIKey(): string {
  const prefix = 'oct-';
  const length = 48;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  const randomString = Array.from(array)
    .map((byte) => chars[byte % chars.length])
    .join('');
  return prefix + randomString;
}

// Validation schemas
const createAPIKeySchema = z.object({
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  expireAt: z.number().int().min(0).default(0), // 0 means never expires
  maxCost: z.number().min(0).default(0), // 0 means unlimited
  supportedModels: z.string().default(''), // empty string means all models supported
});

const updateAPIKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  expireAt: z.number().int().min(0).optional(),
  maxCost: z.number().min(0).optional(),
  supportedModels: z.string().optional(),
});

/**
 * GET /api/v1/admin/apikeys
 * List all API keys
 */
apikeys.get('/', async (c) => {
  try {
    const keys = await getAllAPIKeys(c.env.DB);
    // Don't return the full API key; only return the prefix for identification
    const safeKeys = keys.map((key) => ({
      ...key,
      apiKey: `${key.apiKey.substring(0, 10)}...`,
    }));
    return c.json({
      code: 200,
      data: safeKeys,
    });
  } catch (err) {
    console.error('Failed to list API keys:', err);
    return c.json({ code: 500, message: 'Failed to list API keys' }, 500);
  }
});

/**
 * GET /api/v1/admin/apikeys/:id
 * Get a specific API key
 */
apikeys.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid API key ID' }, 400);
  }

  try {
    const key = await getAPIKeyById(c.env.DB, id);
    if (!key) {
      return c.json({ code: 404, message: 'API key not found' }, 404);
    }
    // Mask the full API key
    return c.json({
      code: 200,
      data: {
        ...key,
        apiKey: `${key.apiKey.substring(0, 10)}...`,
      },
    });
  } catch (err) {
    console.error('Failed to get API key:', err);
    return c.json({ code: 500, message: 'Failed to get API key' }, 500);
  }
});

/**
 * POST /api/v1/admin/apikeys
 * Create a new API key
 */
apikeys.post('/', zValidator('json', createAPIKeySchema), async (c) => {
  const body = c.req.valid('json');

  try {
    // Generate a new API key
    const apiKey = generateAPIKey();

    const keyId = await createAPIKey(c.env.DB, {
      apiKey,
      name: body.name,
      enabled: body.enabled,
      expireAt: body.expireAt,
      maxCost: body.maxCost,
      supportedModels: body.supportedModels,
    });

    return c.json({
      code: 200,
      message: 'API key created successfully',
      data: {
        id: keyId,
        apiKey, // Only return the full key at creation time
      },
    });
  } catch (err) {
    console.error('Failed to create API key:', err);
    return c.json({ code: 500, message: 'Failed to create API key' }, 500);
  }
});

/**
 * PUT /api/v1/admin/apikeys/:id
 * Update an API key
 */
apikeys.put('/:id', zValidator('json', updateAPIKeySchema), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid API key ID' }, 400);
  }

  const body = c.req.valid('json');

  try {
    // Check if API key exists
    const existing = await getAPIKeyById(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'API key not found' }, 404);
    }

    // Update API key (merge existing data with update data)
    const { updateAPIKey } = await import('@/services/db/apikey');
    await updateAPIKey(c.env.DB, {
      id,
      name: body.name !== undefined ? body.name : existing.name,
      apiKey: existing.apiKey,
      enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
      expireAt: body.expireAt !== undefined ? body.expireAt : existing.expireAt,
      maxCost: body.maxCost !== undefined ? body.maxCost : existing.maxCost,
      supportedModels:
        body.supportedModels !== undefined ? body.supportedModels : existing.supportedModels,
    });

    // Invalidate cache
    await invalidateAPIKeyCache(c.env.CACHE, existing.apiKey);

    return c.json({
      code: 200,
      message: 'API key updated successfully',
    });
  } catch (err) {
    console.error('Failed to update API key:', err);
    return c.json({ code: 500, message: 'Failed to update API key' }, 500);
  }
});

/**
 * DELETE /api/v1/admin/apikeys/:id
 * Delete an API key
 */
apikeys.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid API key ID' }, 400);
  }

  try {
    // Check if API key exists
    const existing = await getAPIKeyById(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'API key not found' }, 404);
    }

    await deleteAPIKey(c.env.DB, id);

    // Invalidate cache
    await invalidateAPIKeyCache(c.env.CACHE, existing.apiKey);

    return c.json({
      code: 200,
      message: 'API key deleted successfully',
    });
  } catch (err) {
    console.error('Failed to delete API key:', err);
    return c.json({ code: 500, message: 'Failed to delete API key' }, 500);
  }
});

export default apikeys;
