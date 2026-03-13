/**
 * 認證中間件
 */

import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '@/types';
import { getCachedAPIKey } from '@/services/cache/apikey';

/**
 * API Key 認證中間件
 * 用於 Relay API (/v1/*)
 */
export const apiKeyAuth = () => {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
    async (c, next) => {
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

      // 格式: Bearer sk-octopus-xxx
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

      // 從快取或資料庫驗證 API Key
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

      // 設定上下文
      c.set('apiKeyId', keyInfo.id);
      c.set('supportedModels', keyInfo.supportedModels);

      return await next();
    }
  );
};

/**
 * JWT 認證中間件
 * 用於管理 API (/api/v1/*)
 */
export const jwtAuth = () => {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
    async (c, next) => {
      const authHeader = c.req.header('Authorization');

      if (!authHeader) {
        return c.json(
          {
            code: 401,
            message: '未授權：缺少認證 token',
          },
          401
        );
      }

      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return c.json(
          {
            code: 401,
            message: '未授權：無效的 token 格式',
          },
          401
        );
      }

      const token = parts[1];
      if (!token) {
        return c.json(
          {
            code: 401,
            message: '未授權：無效的 token',
          },
          401
        );
      }

      // 驗證 JWT
      try {
        const { verifyJWT } = await import('@/services/auth/jwt');
        const jwtSecret = c.env.JWT_SECRET || 'default-secret-change-me';
        const payload = await verifyJWT(token, jwtSecret);

        // 設定上下文
        c.set('userId', payload.userId);
        c.set('username', payload.username);

        return await next();
      } catch (err) {
        return c.json(
          {
            code: 401,
            message: '未授權：' + (err as Error).message,
          },
          401
        );
      }
    }
  );
};

/**
 * 管理員認證（JWT）
 */
export const adminAuth = jwtAuth;
