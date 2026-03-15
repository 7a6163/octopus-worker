/**
 * Groups management API
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { invalidateGroupCache } from '@/services/cache/group';
import {
  createGroup,
  deleteGroup,
  getGroup,
  getGroupByModel,
  listGroups,
  updateGroup,
} from '@/services/db/group';
import type { Bindings, Variables } from '@/types';
import { GroupMode } from '@/types/group';

const groups = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Validation schemas
const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  mode: z.nativeEnum(GroupMode),
  match_regex: z.string().default(''),
  first_token_time_out: z.number().int().min(0).default(0),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  mode: z.nativeEnum(GroupMode).optional(),
  match_regex: z.string().optional(),
  first_token_time_out: z.number().int().min(0).optional(),
});

/**
 * GET /api/v1/admin/groups
 * List all groups
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
    return c.json({ code: 500, message: 'Failed to list groups' }, 500);
  }
});

/**
 * GET /api/v1/admin/groups/:id
 * Get a specific group
 */
groups.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid group ID' }, 400);
  }

  try {
    const group = await getGroup(c.env.DB, id);
    if (!group) {
      return c.json({ code: 404, message: 'Group not found' }, 404);
    }
    return c.json({
      code: 200,
      data: group,
    });
  } catch (err) {
    console.error('Failed to get group:', err);
    return c.json({ code: 500, message: 'Failed to get group' }, 500);
  }
});

/**
 * GET /api/v1/admin/groups/by-model/:model
 * Get group by model name
 */
groups.get('/by-model/:model', async (c) => {
  const model = c.req.param('model');

  try {
    const group = await getGroupByModel(c.env.DB, model);
    if (!group) {
      return c.json({ code: 404, message: 'No group found for this model' }, 404);
    }
    return c.json({
      code: 200,
      data: group,
    });
  } catch (err) {
    console.error('Failed to get group by model:', err);
    return c.json({ code: 500, message: 'Failed to get group' }, 500);
  }
});

/**
 * POST /api/v1/admin/groups
 * Create a new group
 */
groups.post('/', zValidator('json', createGroupSchema), async (c) => {
  const body = c.req.valid('json');

  try {
    // Check if name already exists
    const existing = await getGroupByModel(c.env.DB, body.name);
    if (existing) {
      return c.json(
        {
          code: 400,
          message: `Group "${body.name}" already exists`,
        },
        400
      );
    }

    const groupId = await createGroup(c.env.DB, body);

    return c.json({
      code: 200,
      message: 'Group created successfully',
      data: { id: groupId },
    });
  } catch (err) {
    console.error('Failed to create group:', err);
    return c.json({ code: 500, message: 'Failed to create group' }, 500);
  }
});

/**
 * PUT /api/v1/admin/groups/:id
 * Update a group
 */
groups.put('/:id', zValidator('json', updateGroupSchema), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid group ID' }, 400);
  }

  const body = c.req.valid('json');

  try {
    // Check if group exists
    const existing = await getGroup(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'Group not found' }, 404);
    }

    // If updating name, check if the new name is already used by another group
    if (body.name && body.name !== existing.name) {
      const conflict = await getGroupByModel(c.env.DB, body.name);
      if (conflict && conflict.id !== id) {
        return c.json(
          {
            code: 400,
            message: `Group "${body.name}" already exists`,
          },
          400
        );
      }
    }

    await updateGroup(c.env.DB, id, body);

    // Invalidate cache
    await invalidateGroupCache(c.env.CACHE, id);
    // TODO: Also need to invalidate model cache

    return c.json({
      code: 200,
      message: 'Group updated successfully',
    });
  } catch (err) {
    console.error('Failed to update group:', err);
    return c.json({ code: 500, message: 'Failed to update group' }, 500);
  }
});

/**
 * DELETE /api/v1/admin/groups/:id
 * Delete a group
 */
groups.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ code: 400, message: 'Invalid group ID' }, 400);
  }

  try {
    // Check if group exists
    const existing = await getGroup(c.env.DB, id);
    if (!existing) {
      return c.json({ code: 404, message: 'Group not found' }, 404);
    }

    await deleteGroup(c.env.DB, id);

    // Invalidate cache
    await invalidateGroupCache(c.env.CACHE, id);

    return c.json({
      code: 200,
      message: 'Group deleted successfully',
    });
  } catch (err) {
    console.error('Failed to delete group:', err);
    return c.json({ code: 500, message: 'Failed to delete group' }, 500);
  }
});

export default groups;
