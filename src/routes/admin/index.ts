/**
 * Admin API 路由匯總
 */

import { Hono } from 'hono';
import { jwtAuth } from '@/middleware/auth';
import { loginRateLimit } from '@/middleware/rate-limit';
import type { Bindings, Variables } from '@/types';
import apikeyRoutes from './apikeys';
import authRoutes from './auth';
import channelRoutes from './channels';
import groupRoutes from './groups';
import settingsRoutes from './settings';
import statsRoutes from './stats';
import userRoutes from './users';

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Rate limiting on login endpoint only (per IP, 20 req/min)
admin.use('/auth/login', loginRateLimit());

// 認證路由（不需要 JWT）
admin.route('/auth', authRoutes);

// 以下路由需要 JWT 認證
admin.use('/*', jwtAuth());

// 健康檢查
admin.get('/health', (c) => {
  return c.json({
    code: 200,
    message: 'Admin API is healthy',
    data: {
      timestamp: Date.now(),
      user: {
        id: c.get('userId'),
        username: c.get('username'),
      },
    },
  });
});

// 管理路由
admin.route('/channels', channelRoutes);
admin.route('/groups', groupRoutes);
admin.route('/apikeys', apikeyRoutes);
admin.route('/users', userRoutes);
admin.route('/stats', statsRoutes);
admin.route('/settings', settingsRoutes);

export default admin;
