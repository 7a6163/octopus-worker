/**
 * Authentication API routes
 * Corresponds to the original Go project's internal/handler/auth.go
 *
 * Endpoints:
 * - POST /api/v1/auth/login - User login
 * - POST /api/v1/auth/logout - User logout
 * - POST /api/v1/auth/refresh - Refresh token
 * - GET /api/v1/auth/me - Get current user info
 */

import { Hono } from 'hono';
import { extractTokenFromHeader, refreshToken, signJWT, verifyJWT } from '@/services/auth/jwt';
import { getUserById, validateCredentials } from '@/services/db/user';
import type { Bindings, Variables } from '@/types';

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * POST /api/v1/auth/login
 * User login
 */
auth.post('/login', async (c) => {
  try {
    const body = await c.req.json<{ username: string; password: string }>();

    if (!body.username || !body.password) {
      return c.json(
        {
          code: 400,
          message: 'Username and password are required',
        },
        400
      );
    }

    // Validate credentials
    const user = await validateCredentials(c.env.DB, body.username, body.password);

    if (!user) {
      return c.json(
        {
          code: 401,
          message: 'Invalid username or password',
        },
        401
      );
    }

    // Issue JWT
    const jwtSecret = c.env.JWT_SECRET;
    if (!jwtSecret) {
      return c.json({ code: 500, message: 'Server misconfiguration' }, 500);
    }
    const token = await signJWT(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
      },
      {
        secret: jwtSecret,
        expiresIn: 86400, // 24 hours
      }
    );

    return c.json({
      code: 200,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return c.json(
      {
        code: 500,
        message: 'Internal server error',
      },
      500
    );
  }
});

/**
 * POST /api/v1/auth/logout
 * User logout (client deletes token)
 */
auth.post('/logout', async (c) => {
  // JWT is stateless; logout is handled client-side (delete token)
  // For server-side logout, a token blacklist via KV storage could be used
  return c.json({
    code: 200,
    message: 'Logout successful',
  });
});

/**
 * POST /api/v1/auth/refresh
 * Refresh token
 */
auth.post('/refresh', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || null;
    const oldToken = extractTokenFromHeader(authHeader);

    if (!oldToken) {
      return c.json(
        {
          code: 401,
          message: 'Token not provided',
        },
        401
      );
    }

    const jwtSecret = c.env.JWT_SECRET;
    if (!jwtSecret) {
      return c.json({ code: 500, message: 'Server misconfiguration' }, 500);
    }
    const result = await refreshToken(oldToken, {
      secret: jwtSecret,
      expiresIn: 86400,
    });

    return c.json({
      code: 200,
      message: result.refreshed ? 'Token refreshed' : 'Token still valid',
      data: {
        token: result.token,
        refreshed: result.refreshed,
      },
    });
  } catch (_err) {
    return c.json(
      {
        code: 401,
        message: 'Token refresh failed',
      },
      401
    );
  }
});

/**
 * GET /api/v1/auth/me
 * Get current user info (requires JWT authentication)
 */
auth.get('/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || null;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return c.json(
        {
          code: 401,
          message: 'Token not provided',
        },
        401
      );
    }

    // Verify JWT
    const jwtSecret = c.env.JWT_SECRET;
    if (!jwtSecret) {
      return c.json({ code: 500, message: 'Server misconfiguration' }, 500);
    }
    const payload = await verifyJWT(token, jwtSecret);

    // Fetch latest user info from database
    const user = await getUserById(c.env.DB, payload.userId);

    if (!user) {
      return c.json(
        {
          code: 404,
          message: 'User not found',
        },
        404
      );
    }

    return c.json({
      code: 200,
      message: 'Success',
      data: {
        id: user.id,
        username: user.username,
        role: user.role,
        enabled: user.enabled,
      },
    });
  } catch (_err) {
    return c.json(
      {
        code: 401,
        message: 'Authentication failed',
      },
      401
    );
  }
});

export default auth;
