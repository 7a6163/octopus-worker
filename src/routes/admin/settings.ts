/**
 * Settings 管理 API
 */

import { Hono } from 'hono';
import type { Bindings, Variables } from '@/types';
import { getAllSettings, updateSetting } from '@/services/db/settings';

const settings = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * GET /api/v1/admin/settings
 * 列出所有設定
 */
settings.get('/', async (c) => {
  try {
    const all = await getAllSettings(c.env.DB);
    return c.json({ code: 200, data: all });
  } catch (err) {
    console.error('Failed to list settings:', err);
    return c.json({ code: 500, message: 'Failed to list settings' }, 500);
  }
});

/**
 * PUT /api/v1/admin/settings/:key
 * 更新設定值
 */
settings.put('/:key', async (c) => {
  const key = c.req.param('key');

  try {
    const body = await c.req.json<{ value: string }>();
    if (!body.value && body.value !== '') {
      return c.json({ code: 400, message: 'value is required' }, 400);
    }
    await updateSetting(c.env.DB, key, body.value);
    return c.json({ code: 200, message: 'updated' });
  } catch (err) {
    console.error('Failed to update setting:', err);
    return c.json({ code: 500, message: 'Failed to update setting' }, 500);
  }
});

export default settings;
