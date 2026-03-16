/**
 * Settings management API
 */

import { Hono } from 'hono';
import { getAllSettings, updateSetting } from '@/services/db/settings';
import type { Bindings, Variables } from '@/types';

/** Allowlist of valid setting keys that may be updated via the API. */
const VALID_SETTING_KEYS = new Set([
  // Core settings (from initial migration)
  'proxy_url',
  'stats_save_interval',
  'cors_allow_origins',
  'model_info_update_interval',
  'sync_llm_interval',
  // Circuit breaker settings
  'circuit_breaker_threshold',
  'circuit_breaker_cooldown',
  'circuit_breaker_max_cooldown',
]);

const settings = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * GET /api/v1/admin/settings
 * List all settings
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
 * Update a setting value
 */
settings.put('/:key', async (c) => {
  const key = c.req.param('key');

  if (!VALID_SETTING_KEYS.has(key)) {
    return c.json({ code: 400, message: `Unknown setting key: ${key}` }, 400);
  }

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
