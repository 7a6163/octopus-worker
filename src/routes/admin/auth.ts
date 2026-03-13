/**
 * 認證 API 路由
 * 對應原始 Go 專案的 internal/handler/auth.go
 *
 * 端點：
 * - POST /api/v1/auth/login - 使用者登入
 * - POST /api/v1/auth/logout - 使用者登出
 * - POST /api/v1/auth/refresh - 刷新 Token
 * - GET /api/v1/auth/me - 獲取當前使用者資訊
 */

import { Hono } from 'hono';
import type { Bindings, Variables } from '@/types';
import { signJWT, verifyJWT, refreshToken, extractTokenFromHeader } from '@/services/auth/jwt';
import { validateCredentials, getUserById } from '@/services/db/user';

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * POST /api/v1/auth/login
 * 使用者登入
 */
auth.post('/login', async (c) => {
  try {
    const body = await c.req.json<{ username: string; password: string }>();

    if (!body.username || !body.password) {
      return c.json(
        {
          code: 400,
          message: '使用者名稱和密碼不能為空',
        },
        400
      );
    }

    // 驗證憑證
    const user = await validateCredentials(c.env.DB, body.username, body.password);

    if (!user) {
      return c.json(
        {
          code: 401,
          message: '使用者名稱或密碼錯誤',
        },
        401
      );
    }

    // 簽發 JWT
    const jwtSecret = c.env.JWT_SECRET || 'default-secret-change-me';
    const token = await signJWT(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
      },
      {
        secret: jwtSecret,
        expiresIn: 86400, // 24 小時
      }
    );

    return c.json({
      code: 200,
      message: '登入成功',
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
        message: '登入失敗：' + (err as Error).message,
      },
      500
    );
  }
});

/**
 * POST /api/v1/auth/logout
 * 使用者登出（客戶端刪除 Token）
 */
auth.post('/logout', async (c) => {
  // JWT 是無狀態的，登出由客戶端處理（刪除 Token）
  // 如果需要伺服器端登出，可以使用 Token 黑名單（KV 存儲）
  return c.json({
    code: 200,
    message: '登出成功',
  });
});

/**
 * POST /api/v1/auth/refresh
 * 刷新 Token
 */
auth.post('/refresh', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || null;
    const oldToken = extractTokenFromHeader(authHeader);

    if (!oldToken) {
      return c.json(
        {
          code: 401,
          message: '未提供 Token',
        },
        401
      );
    }

    const jwtSecret = c.env.JWT_SECRET || 'default-secret-change-me';
    const result = await refreshToken(oldToken, {
      secret: jwtSecret,
      expiresIn: 86400,
    });

    return c.json({
      code: 200,
      message: result.refreshed ? 'Token 已刷新' : 'Token 仍然有效',
      data: {
        token: result.token,
        refreshed: result.refreshed,
      },
    });
  } catch (err) {
    return c.json(
      {
        code: 401,
        message: 'Token 刷新失敗：' + (err as Error).message,
      },
      401
    );
  }
});

/**
 * GET /api/v1/auth/me
 * 獲取當前使用者資訊（需要 JWT 認證）
 */
auth.get('/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || null;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return c.json(
        {
          code: 401,
          message: '未提供 Token',
        },
        401
      );
    }

    // 驗證 JWT
    const jwtSecret = c.env.JWT_SECRET || 'default-secret-change-me';
    const payload = await verifyJWT(token, jwtSecret);

    // 從資料庫獲取最新的使用者資訊
    const user = await getUserById(c.env.DB, payload.userId);

    if (!user) {
      return c.json(
        {
          code: 404,
          message: '使用者不存在',
        },
        404
      );
    }

    return c.json({
      code: 200,
      message: '成功',
      data: {
        id: user.id,
        username: user.username,
        role: user.role,
        enabled: user.enabled,
      },
    });
  } catch (err) {
    return c.json(
      {
        code: 401,
        message: '認證失敗：' + (err as Error).message,
      },
      401
    );
  }
});

export default auth;
