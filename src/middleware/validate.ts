/**
 * Validation middleware
 */

import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '@/types';

/**
 * Ensure request is JSON
 */
export const requireJson = () => {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
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
  });
};

/**
 * Validate request body size
 */
export const validateBodySize = (maxSizeBytes: number) => {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const contentLength = c.req.header('Content-Length');

    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
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
  });
};
