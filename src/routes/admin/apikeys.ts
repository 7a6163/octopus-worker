/**
 * API Keys 管理 API
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { invalidateAPIKeyCache } from '@/services/cache/apikey';
import { createAPIKey, deleteAPIKey, getAllAPIKeys, getAPIKeyById } from '@/services/db/apikey';
import type { Bindings, Variables } from '@/types';

const apikeys = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * 生成隨機 API Key
 */
function generateAPIKey(): string {
  const prefix = 'sk-';
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
  expireAt: z.number().int().min(0).default(0), // 0 表示永不過期
  maxCost: z.number().min(0).default(0), // 0 表示無限制
  supportedModels: z.string().default(''), // 空字串表示支援所有模型
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
 * 列出所有 API keys
 */
apikeys.get('/', async (c) => {
  try {
    const keys = await getAllAPIKeys(c.env.DB);
    // 不返回完整的 API key，只返回前綴用於識別
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
    return c.json({ code: 500, message: '獲取 API keys 列表失敗' }, 500);
  }
});

/**
 * GET /api/v1/admin/apikeys/:id
 * 獲取指定 API key
 */
apikeys.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: '無效的 API key ID' }, 400);
  }

  try {
    const key = await getAPIKeyById(c.env.DB, id);
    if (!key) {
      return c.json({ code: 404, message: 'API key 不存在' }, 404);
    }
    // 隱藏完整的 API key
    return c.json({
      code: 200,
      data: {
        ...key,
        apiKey: `${key.apiKey.substring(0, 10)}...`,
      },
    });
  } catch (err) {
    console.error('Failed to get API key:', err);
    return c.json({ code: 500, message: '獲取 API key 失敗' }, 500);
  }
});

/**
 * POST /api/v1/admin/apikeys
 * 創建新 API key
 */
apikeys.post('/', zValidator('json', createAPIKeySchema), async (c) => {
  const body = c.req.valid('json');

  try {
    // 生成新的 API key
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
      message: 'API key 創建成功',
      data: {
        id: keyId,
        apiKey, // 只在創建時返回完整的 key
      },
    });
  } catch (err) {
    console.error('Failed to create API key:', err);
    return c.json({ code: 500, message: '創建 API key 失敗' }, 500);
  }
});

/**
 * PUT /api/v1/admin/apikeys/:id
 * 更新 API key
 */
apikeys.put('/:id', zValidator('json', updateAPIKeySchema), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: '無效的 API key ID' }, 400);
  }

  const body = c.req.valid('json');

  try {
    // 檢查 API key 是否存在
    const existing = await getAPIKeyById(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'API key 不存在' }, 404);
    }

    // 更新 API Key（合併現有資料和更新資料）
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

    // 清除快取
    await invalidateAPIKeyCache(c.env.CACHE, existing.apiKey);

    return c.json({
      code: 200,
      message: 'API key 更新成功',
    });
  } catch (err) {
    console.error('Failed to update API key:', err);
    return c.json({ code: 500, message: '更新 API key 失敗' }, 500);
  }
});

/**
 * DELETE /api/v1/admin/apikeys/:id
 * 刪除 API key
 */
apikeys.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: '無效的 API key ID' }, 400);
  }

  try {
    // 檢查 API key 是否存在
    const existing = await getAPIKeyById(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'API key 不存在' }, 404);
    }

    await deleteAPIKey(c.env.DB, id);

    // 清除快取
    await invalidateAPIKeyCache(c.env.CACHE, existing.apiKey);

    return c.json({
      code: 200,
      message: 'API key 刪除成功',
    });
  } catch (err) {
    console.error('Failed to delete API key:', err);
    return c.json({ code: 500, message: '刪除 API key 失敗' }, 500);
  }
});

export default apikeys;
