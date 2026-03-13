/**
 * Password 雜湊服務測試
 */

import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../services/auth/password';

describe('Password Service', () => {
  const testPassword = 'MySecurePassword123!';

  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const hashed = await hashPassword(testPassword);

      expect(hashed).toBeTruthy();
      expect(typeof hashed).toBe('string');
      expect(hashed).toContain(':'); // Format: salt:hash
    });

    it('should create different hashes for same password', async () => {
      const hash1 = await hashPassword(testPassword);
      const hash2 = await hashPassword(testPassword);

      expect(hash1).not.toBe(hash2); // Different salts
    });

    it('should create hash with salt and hash parts', async () => {
      const hashed = await hashPassword(testPassword);
      const parts = hashed.split(':');

      expect(parts).toHaveLength(2);
      expect(parts[0]).toBeTruthy(); // Salt
      expect(parts[1]).toBeTruthy(); // Hash
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const hashed = await hashPassword(testPassword);
      const isValid = await verifyPassword(testPassword, hashed);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hashed = await hashPassword(testPassword);
      const isValid = await verifyPassword('WrongPassword', hashed);

      expect(isValid).toBe(false);
    });

    it('should reject malformed hash', async () => {
      const isValid = await verifyPassword(testPassword, 'invalid-hash');

      expect(isValid).toBe(false);
    });

    it('should reject empty password', async () => {
      const hashed = await hashPassword(testPassword);
      const isValid = await verifyPassword('', hashed);

      expect(isValid).toBe(false);
    });
  });
});
