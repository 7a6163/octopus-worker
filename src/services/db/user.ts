/**
 * User data access layer
 *
 * Features:
 * - User CRUD operations
 * - Password verification
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { User } from '@/types/user';

/**
 * Get a User by username
 */
export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  const result = await db
    .prepare(
      `SELECT id, username, password, role, enabled
       FROM users
       WHERE username = ?`
    )
    .bind(username)
    .first<{
      id: number;
      username: string;
      password: string;
      role: string;
      enabled: number;
    }>();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    username: result.username,
    password: result.password,
    role: result.role as 'admin' | 'user',
    enabled: result.enabled === 1,
  };
}

/**
 * Get a User by ID
 */
export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  const result = await db
    .prepare(
      `SELECT id, username, password, role, enabled
       FROM users
       WHERE id = ?`
    )
    .bind(id)
    .first<{
      id: number;
      username: string;
      password: string;
      role: string;
      enabled: number;
    }>();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    username: result.username,
    password: result.password,
    role: result.role as 'admin' | 'user',
    enabled: result.enabled === 1,
  };
}

/**
 * Get all Users
 */
export async function getAllUsers(db: D1Database): Promise<Omit<User, 'password'>[]> {
  const result = await db
    .prepare(
      `SELECT id, username, role, enabled
       FROM users
       ORDER BY id ASC`
    )
    .all<{
      id: number;
      username: string;
      role: string;
      enabled: number;
    }>();

  return (result.results || []).map((row) => ({
    id: row.id,
    username: row.username,
    role: row.role as 'admin' | 'user',
    enabled: row.enabled === 1,
  }));
}

/**
 * Create a new User
 */
export async function createUser(db: D1Database, user: Omit<User, 'id'>): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO users (username, password, role, enabled)
       VALUES (?, ?, ?, ?)`
    )
    .bind(
      user.username,
      user.password, // Should already be a hashed password
      user.role,
      user.enabled ? 1 : 0
    )
    .run();

  return result.meta.last_row_id as number;
}

/**
 * Update a User
 */
export async function updateUser(db: D1Database, user: User): Promise<void> {
  await db
    .prepare(
      `UPDATE users
       SET username = ?,
           password = ?,
           role = ?,
           enabled = ?
       WHERE id = ?`
    )
    .bind(user.username, user.password, user.role, user.enabled ? 1 : 0, user.id)
    .run();
}

/**
 * Delete a User
 */
export async function deleteUser(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
}

/**
 * Validate user credentials
 */
export async function validateCredentials(
  db: D1Database,
  username: string,
  password: string
): Promise<User | null> {
  const user = await getUserByUsername(db, username);

  if (!user) {
    return null;
  }

  // Check if enabled
  if (!user.enabled) {
    return null;
  }

  // Verify password
  const { verifyPassword } = await import('@/services/auth/password');
  const isValid = await verifyPassword(password, user.password);

  if (!isValid) {
    return null;
  }

  return user;
}
