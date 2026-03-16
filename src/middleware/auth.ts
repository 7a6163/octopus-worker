/**
 * Authentication middleware
 */

import { createMiddleware } from 'hono/factory';
import { getCachedAPIKey } from '@/services/cache/apikey';
import type { Bindings, Variables } from '@/types';

/**
 * API Key authentication middleware
 * Used for Relay API (/v1/*)
 */
export const apiKeyAuth = () => {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json(
        {
          error: {
            message: 'Missing Authorization header',
            type: 'authentication_error',
          },
        },
        401
      );
    }

    // Format: Bearer sk-octopus-xxx
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return c.json(
        {
          error: {
            message: 'Invalid Authorization header format',
            type: 'authentication_error',
          },
        },
        401
      );
    }

    const apiKey = parts[1];
    if (!apiKey) {
      return c.json(
        {
          error: {
            message: 'Missing API key',
            type: 'authentication_error',
          },
        },
        401
      );
    }

    // Validate API Key from cache or database
    const keyInfo = await getCachedAPIKey(c.env.CACHE, c.env.DB, apiKey);

    if (!keyInfo) {
      return c.json(
        {
          error: {
            message: 'Invalid API key',
            type: 'authentication_error',
          },
        },
        401
      );
    }

    // Set context
    c.set('apiKeyId', keyInfo.id);
    c.set('supportedModels', keyInfo.supportedModels);

    return await next();
  });
};

/**
 * JWT authentication middleware
 * Used for Admin API (/api/v1/*)
 */
export const jwtAuth = () => {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json(
        {
          code: 401,
          message: 'Unauthorized: missing authentication token',
        },
        401
      );
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return c.json(
        {
          code: 401,
          message: 'Unauthorized: invalid token format',
        },
        401
      );
    }

    const token = parts[1];
    if (!token) {
      return c.json(
        {
          code: 401,
          message: 'Unauthorized: invalid token',
        },
        401
      );
    }

    // Verify JWT
    try {
      const { verifyJWT } = await import('@/services/auth/jwt');
      const jwtSecret = c.env.JWT_SECRET;
      if (!jwtSecret) {
        return c.json({ code: 500, message: 'Server misconfiguration: JWT_SECRET not set' }, 500);
      }
      if (jwtSecret.length < 32) {
        return c.json({ code: 500, message: 'Server misconfiguration: JWT_SECRET too short' }, 500);
      }
      const payload = await verifyJWT(token, jwtSecret);

      // Set context
      c.set('userId', payload.userId);
      c.set('username', payload.username);
      c.set('role', payload.role);

      return await next();
    } catch (err) {
      return c.json(
        {
          code: 401,
          message: `Unauthorized: ${(err as Error).message}`,
        },
        401
      );
    }
  });
};

/**
 * Admin authentication (JWT)
 */
export const adminAuth = jwtAuth;

/**
 * Role-based authorization middleware
 * Requires jwtAuth to run first (sets 'role' in context)
 * Returns 403 if user is not an admin
 */
export const requireAdmin = () => {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const role = c.get('role');
    if (role !== 'admin') {
      return c.json(
        {
          code: 403,
          message: 'Forbidden: admin access required',
        },
        403
      );
    }
    return await next();
  });
};
