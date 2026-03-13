/**
 * 驗證中間件
 */

import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '@/types';

/**
 * 確保請求為 JSON
 */
export const requireJson = () => {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
    async (c, next) => {
      const contentType = c.req.header('Content-Type');

      if (!contentType || !contentType.includes('application/json')) {
        return c.json(
          {
            error: {
              message: 'Content-Type must be application/json',
              type: 'invalid_request_error',
            },
          },
          400
        );
      }

      return await next();
    }
  );
};

/**
 * 驗證請求體大小
 */
export const validateBodySize = (maxSizeBytes: number) => {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
    async (c, next) => {
      const contentLength = c.req.header('Content-Length');

      if (contentLength && parseInt(contentLength) > maxSizeBytes) {
        return c.json(
          {
            error: {
              message: `Request body too large (max: ${maxSizeBytes} bytes)`,
              type: 'invalid_request_error',
            },
          },
          413
        );
      }

      return await next();
    }
  );
};
