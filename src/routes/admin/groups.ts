/**
 * Groups 管理 API
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Bindings, Variables } from '@/types';
import { GroupMode } from '@/types/group';
import {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  getGroupByModel,
} from '@/services/db/group';
import { invalidateGroupCache } from '@/services/cache/group';

const groups = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Validation schemas
const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  mode: z.nativeEnum(GroupMode),
  enabled: z.boolean().default(true),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(100).optional(),
  mode: z.nativeEnum(GroupMode).optional(),
  enabled: z.boolean().optional(),
});

/**
 * GET /api/v1/admin/groups
 * 列出所有 groups
 */
groups.get('/', async (c) => {
  try {
    const groupList = await listGroups(c.env.DB);
    return c.json({
      code: 200,
      data: groupList,
    });
  } catch (err) {
    console.error('Failed to list groups:', err);
    return c.json({ code: 500, message: '獲取 groups 列表失敗' }, 500);
  }
});

/**
 * GET /api/v1/admin/groups/:id
 * 獲取指定 group
 */
groups.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ code: 400, message: '無效的 group ID' }, 400);
  }

  try {
    const group = await getGroup(c.env.DB, id);
    if (!group) {
      return c.json({ code: 404, message: 'Group 不存在' }, 404);
    }
    return c.json({
      code: 200,
      data: group,
    });
  } catch (err) {
    console.error('Failed to get group:', err);
    return c.json({ code: 500, message: '獲取 group 失敗' }, 500);
  }
});

/**
 * GET /api/v1/admin/groups/by-model/:model
 * 根據模型名稱獲取 group
 */
groups.get('/by-model/:model', async (c) => {
  const model = c.req.param('model');

  try {
    const group = await getGroupByModel(c.env.DB, model);
    if (!group) {
      return c.json({ code: 404, message: '未找到該模型對應的 group' }, 404);
    }
    return c.json({
      code: 200,
      data: group,
    });
  } catch (err) {
    console.error('Failed to get group by model:', err);
    return c.json({ code: 500, message: '獲取 group 失敗' }, 500);
  }
});

/**
 * POST /api/v1/admin/groups
 * 創建新 group
 */
groups.post('/', zValidator('json', createGroupSchema), async (c) => {
  const body = c.req.valid('json');

  try {
    // 檢查該模型是否已存在 group
    const existing = await getGroupByModel(c.env.DB, body.model);
    if (existing) {
      return c.json(
        {
          code: 400,
          message: `模型 ${body.model} 已存在對應的 group`,
        },
        400
      );
    }

    const groupId = await createGroup(c.env.DB, body);

    return c.json({
      code: 200,
      message: 'Group 創建成功',
      data: { id: groupId },
    });
  } catch (err) {
    console.error('Failed to create group:', err);
    return c.json({ code: 500, message: '創建 group 失敗' }, 500);
  }
});

/**
 * PUT /api/v1/admin/groups/:id
 * 更新 group
 */
groups.put('/:id', zValidator('json', updateGroupSchema), async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ code: 400, message: '無效的 group ID' }, 400);
  }

  const body = c.req.valid('json');

  try {
    // 檢查 group 是否存在
    const existing = await getGroup(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'Group 不存在' }, 404);
    }

    // 如果更新模型名稱，檢查新模型是否已被其他 group 使用
    if (body.model && body.model !== existing.name) {
      const conflict = await getGroupByModel(c.env.DB, body.model);
      if (conflict && conflict.id !== id) {
        return c.json(
          {
            code: 400,
            message: `模型 ${body.model} 已被其他 group 使用`,
          },
          400
        );
      }
    }

    await updateGroup(c.env.DB, id, body);

    // 清除快取
    await invalidateGroupCache(c.env.CACHE, id);
    // TODO: 也需要清除 model 快取

    return c.json({
      code: 200,
      message: 'Group 更新成功',
    });
  } catch (err) {
    console.error('Failed to update group:', err);
    return c.json({ code: 500, message: '更新 group 失敗' }, 500);
  }
});

/**
 * DELETE /api/v1/admin/groups/:id
 * 刪除 group
 */
groups.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ code: 400, message: '無效的 group ID' }, 400);
  }

  try {
    // 檢查 group 是否存在
    const existing = await getGroup(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'Group 不存在' }, 404);
    }

    await deleteGroup(c.env.DB, id);

    // 清除快取
    await invalidateGroupCache(c.env.CACHE, id);

    return c.json({
      code: 200,
      message: 'Group 刪除成功',
    });
  } catch (err) {
    console.error('Failed to delete group:', err);
    return c.json({ code: 500, message: '刪除 group 失敗' }, 500);
  }
});

export default groups;
