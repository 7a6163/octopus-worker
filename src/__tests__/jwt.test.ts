/**
 * JWT 認證服務測試
 */

import { describe, expect, it } from 'vitest';
import { refreshToken, signJWT, verifyJWT } from '../services/auth/jwt';

describe('JWT Service', () => {
  const testSecret = 'test-secret-key';
  const testPayload = {
    userId: 1,
    username: 'testuser',
    role: 'admin' as const,
  };

  describe('signJWT', () => {
    it('should create a valid JWT token', async () => {
      const token = await signJWT(testPayload, {
        secret: testSecret,
        expiresIn: 3600,
      });

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // Header.Payload.Signature
    });

    it('should include payload data in token', async () => {
      const token = await signJWT(testPayload, {
        secret: testSecret,
        expiresIn: 3600,
      });

      const verified = await verifyJWT(token, testSecret);
      expect(verified.userId).toBe(testPayload.userId);
      expect(verified.username).toBe(testPayload.username);
      expect(verified.role).toBe(testPayload.role);
    });
  });

  describe('verifyJWT', () => {
    it('should verify a valid token', async () => {
      const token = await signJWT(testPayload, {
        secret: testSecret,
        expiresIn: 3600,
      });

      const verified = await verifyJWT(token, testSecret);
      expect(verified).toBeTruthy();
      expect(verified.userId).toBe(testPayload.userId);
    });

    it('should reject token with wrong secret', async () => {
      const token = await signJWT(testPayload, {
        secret: testSecret,
        expiresIn: 3600,
      });

      await expect(verifyJWT(token, 'wrong-secret')).rejects.toThrow();
    });

    it('should reject expired token', async () => {
      const token = await signJWT(testPayload, {
        secret: testSecret,
        expiresIn: -1, // Already expired
      });

      await expect(verifyJWT(token, testSecret)).rejects.toThrow('expired');
    });

    it('should reject malformed token', async () => {
      await expect(verifyJWT('invalid.token', testSecret)).rejects.toThrow();
    });
  });

  describe('refreshToken', () => {
    it('should refresh a token nearing expiration', async () => {
      const token = await signJWT(testPayload, {
        secret: testSecret,
        expiresIn: 1000, // 1000 seconds
      });

      const result = await refreshToken(token, {
        secret: testSecret,
        expiresIn: 3600,
      });

      expect(result.refreshed).toBe(true);
      expect(result.token).not.toBe(token);

      // New token should be valid
      const verified = await verifyJWT(result.token, testSecret);
      expect(verified.userId).toBe(testPayload.userId);
    });

    it('should not refresh a fresh token', async () => {
      const token = await signJWT(testPayload, {
        secret: testSecret,
        expiresIn: 7200, // 2 hours, not near expiration
      });

      const result = await refreshToken(token, {
        secret: testSecret,
        expiresIn: 3600,
      });

      expect(result.refreshed).toBe(false);
      expect(result.token).toBe(token);
    });
  });
});
