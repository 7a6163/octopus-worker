/**
 * Users 管理 API
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Bindings, Variables } from '@/types';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getUserByUsername,
} from '@/services/db/user';
import { hashPassword } from '@/services/auth/password';

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Validation schemas
const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  role: z.enum(['admin', 'user']),
  enabled: z.boolean().default(true),
});

const updateUserSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  password: z.string().min(6).max(100).optional(),
  role: z.enum(['admin', 'user']).optional(),
  enabled: z.boolean().optional(),
});

/**
 * GET /api/v1/admin/users
 * 列出所有使用者
 */
users.get('/', async (c) => {
  try {
    const userList = await getAllUsers(c.env.DB);
    return c.json({
      code: 200,
      data: userList,
    });
  } catch (err) {
    console.error('Failed to list users:', err);
    return c.json({ code: 500, message: '獲取使用者列表失敗' }, 500);
  }
});

/**
 * GET /api/v1/admin/users/:id
 * 獲取指定使用者
 */
users.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ code: 400, message: '無效的使用者 ID' }, 400);
  }

  try {
    const user = await getUserById(c.env.DB, id);
    if (!user) {
      return c.json({ code: 404, message: '使用者不存在' }, 404);
    }
    // 不返回密碼
    const { password, ...safeUser } = user;
    return c.json({
      code: 200,
      data: safeUser,
    });
  } catch (err) {
    console.error('Failed to get user:', err);
    return c.json({ code: 500, message: '獲取使用者失敗' }, 500);
  }
});

/**
 * POST /api/v1/admin/users
 * 創建新使用者
 */
users.post('/', zValidator('json', createUserSchema), async (c) => {
  const body = c.req.valid('json');

  try {
    // 檢查使用者名稱是否已存在
    const existing = await getUserByUsername(c.env.DB, body.username);
    if (existing) {
      return c.json(
        {
          code: 400,
          message: `使用者名稱 ${body.username} 已存在`,
        },
        400
      );
    }

    // 雜湊密碼
    const hashedPassword = await hashPassword(body.password);

    const userId = await createUser(c.env.DB, {
      username: body.username,
      password: hashedPassword,
      role: body.role,
      enabled: body.enabled,
    });

    return c.json({
      code: 200,
      message: '使用者創建成功',
      data: { id: userId },
    });
  } catch (err) {
    console.error('Failed to create user:', err);
    return c.json({ code: 500, message: '創建使用者失敗' }, 500);
  }
});

/**
 * PUT /api/v1/admin/users/:id
 * 更新使用者
 */
users.put('/:id', zValidator('json', updateUserSchema), async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ code: 400, message: '無效的使用者 ID' }, 400);
  }

  const body = c.req.valid('json');

  try {
    // 檢查使用者是否存在
    const existing = await getUserById(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: '使用者不存在' }, 404);
    }

    // 如果更新使用者名稱，檢查是否已被其他使用者使用
    if (body.username && body.username !== existing.username) {
      const conflict = await getUserByUsername(c.env.DB, body.username);
      if (conflict && conflict.id !== id) {
        return c.json(
          {
            code: 400,
            message: `使用者名稱 ${body.username} 已被使用`,
          },
          400
        );
      }
    }

    // 準備更新數據
    const updateData = {
      id,
      username: body.username || existing.username,
      password: existing.password,
      role: body.role || existing.role,
      enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
    };

    // 如果更新密碼，雜湊新密碼
    if (body.password) {
      updateData.password = await hashPassword(body.password);
    }

    await updateUser(c.env.DB, updateData);

    return c.json({
      code: 200,
      message: '使用者更新成功',
    });
  } catch (err) {
    console.error('Failed to update user:', err);
    return c.json({ code: 500, message: '更新使用者失敗' }, 500);
  }
});

/**
 * DELETE /api/v1/admin/users/:id
 * 刪除使用者
 */
users.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ code: 400, message: '無效的使用者 ID' }, 400);
  }

  try {
    // 檢查使用者是否存在
    const existing = await getUserById(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: '使用者不存在' }, 404);
    }

    // 防止刪除最後一個管理員
    const allUsers = await getAllUsers(c.env.DB);
    const adminCount = allUsers.filter((u) => u.role === 'admin').length;
    if (existing.role === 'admin' && adminCount <= 1) {
      return c.json(
        {
          code: 400,
          message: '無法刪除最後一個管理員帳號',
        },
        400
      );
    }

    await deleteUser(c.env.DB, id);

    return c.json({
      code: 200,
      message: '使用者刪除成功',
    });
  } catch (err) {
    console.error('Failed to delete user:', err);
    return c.json({ code: 500, message: '刪除使用者失敗' }, 500);
  }
});

export default users;
