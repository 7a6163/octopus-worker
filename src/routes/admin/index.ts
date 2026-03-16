/**
 * Admin API route aggregation
 */

import { Hono } from 'hono';
import { jwtAuth, requireAdmin } from '@/middleware/auth';
import { loginRateLimit } from '@/middleware/rate-limit';
import type { Bindings, Variables } from '@/types';
import apikeyRoutes from './apikeys';
import { authProtectedRoutes, authPublicRoutes } from './auth';
import channelRoutes from './channels';
import groupRoutes from './groups';
import settingsRoutes from './settings';
import statsRoutes from './stats';
import userRoutes from './users';

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Rate limiting on login endpoint only (per IP, 20 req/min)
admin.use('/auth/login', loginRateLimit());

// Public auth routes (no JWT required) - login, logout
admin.route('/auth', authPublicRoutes);

// Routes below require JWT authentication
admin.use('/*', jwtAuth());

// Protected auth routes (JWT required) - me, refresh
admin.route('/auth', authProtectedRoutes);

// Health check
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

// Admin routes (require admin role)
admin.use('/channels/*', requireAdmin());
admin.use('/groups/*', requireAdmin());
admin.use('/apikeys/*', requireAdmin());
admin.use('/users/*', requireAdmin());
admin.use('/stats/*', requireAdmin());
admin.use('/settings/*', requireAdmin());

admin.route('/channels', channelRoutes);
admin.route('/groups', groupRoutes);
admin.route('/apikeys', apikeyRoutes);
admin.route('/users', userRoutes);
admin.route('/stats', statsRoutes);
admin.route('/settings', settingsRoutes);

export default admin;
