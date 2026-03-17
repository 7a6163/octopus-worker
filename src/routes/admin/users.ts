/**
 * Users management API
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { hashPassword } from '@/services/auth/password';
import {
  createUser,
  deleteUser,
  getAllUsers,
  getUserById,
  getUserByUsername,
  updateUser,
} from '@/services/db/user';
import type { Bindings, Variables } from '@/types';

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Validation schemas
const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(12).max(100),
  role: z.enum(['admin', 'user']),
  enabled: z.boolean().default(true),
});

const updateUserSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  password: z.string().min(12).max(100).optional(),
  role: z.enum(['admin', 'user']).optional(),
  enabled: z.boolean().optional(),
});

/**
 * GET /api/v1/admin/users
 * List all users
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
    return c.json({ code: 500, message: 'Failed to list users' }, 500);
  }
});

/**
 * GET /api/v1/admin/users/:id
 * Get a specific user
 */
users.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid user ID' }, 400);
  }

  try {
    const user = await getUserById(c.env.DB, id);
    if (!user) {
      return c.json({ code: 404, message: 'User not found' }, 404);
    }
    // Don't return the password
    const { password, ...safeUser } = user;
    return c.json({
      code: 200,
      data: safeUser,
    });
  } catch (err) {
    console.error('Failed to get user:', err);
    return c.json({ code: 500, message: 'Failed to get user' }, 500);
  }
});

/**
 * POST /api/v1/admin/users
 * Create a new user
 */
users.post('/', zValidator('json', createUserSchema), async (c) => {
  const body = c.req.valid('json');

  try {
    // Check if username already exists
    const existing = await getUserByUsername(c.env.DB, body.username);
    if (existing) {
      return c.json(
        {
          code: 400,
          message: `Username "${body.username}" already exists`,
        },
        400
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(body.password);

    const userId = await createUser(c.env.DB, {
      username: body.username,
      password: hashedPassword,
      role: body.role,
      enabled: body.enabled,
    });

    return c.json({
      code: 200,
      message: 'User created successfully',
      data: { id: userId },
    });
  } catch (err) {
    console.error('Failed to create user:', err);
    return c.json({ code: 500, message: 'Failed to create user' }, 500);
  }
});

/**
 * PUT /api/v1/admin/users/:id
 * Update a user
 */
users.put('/:id', zValidator('json', updateUserSchema), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid user ID' }, 400);
  }

  const body = c.req.valid('json');

  try {
    // Check if user exists
    const existing = await getUserById(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'User not found' }, 404);
    }

    // If updating username, check if it's already taken by another user
    if (body.username && body.username !== existing.username) {
      const conflict = await getUserByUsername(c.env.DB, body.username);
      if (conflict && conflict.id !== id) {
        return c.json(
          {
            code: 400,
            message: `Username "${body.username}" is already taken`,
          },
          400
        );
      }
    }

    // Prepare update data
    const updateData = {
      id,
      username: body.username || existing.username,
      password: existing.password,
      role: body.role || existing.role,
      enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
    };

    // If updating password, hash the new password
    if (body.password) {
      updateData.password = await hashPassword(body.password);
    }

    await updateUser(c.env.DB, updateData);

    return c.json({
      code: 200,
      message: 'User updated successfully',
    });
  } catch (err) {
    console.error('Failed to update user:', err);
    return c.json({ code: 500, message: 'Failed to update user' }, 500);
  }
});

/**
 * DELETE /api/v1/admin/users/:id
 * Delete a user
 */
users.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid user ID' }, 400);
  }

  try {
    // Check if user exists
    const existing = await getUserById(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'User not found' }, 404);
    }

    // Prevent deleting the last admin
    const allUsers = await getAllUsers(c.env.DB);
    const adminCount = allUsers.filter((u) => u.role === 'admin').length;
    if (existing.role === 'admin' && adminCount <= 1) {
      return c.json(
        {
          code: 400,
          message: 'Cannot delete the last admin account',
        },
        400
      );
    }

    await deleteUser(c.env.DB, id);

    return c.json({
      code: 200,
      message: 'User deleted successfully',
    });
  } catch (err) {
    console.error('Failed to delete user:', err);
    return c.json({ code: 500, message: 'Failed to delete user' }, 500);
  }
});

export default users;
