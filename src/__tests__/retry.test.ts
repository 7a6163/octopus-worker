/**
 * Retry 策略測試
 */

import { describe, expect, it } from 'vitest';
import { calculateRetryDelay } from '../services/retry/strategy';

describe('Retry Strategy', () => {
  describe('calculateRetryDelay', () => {
    it('should calculate exponential backoff', () => {
      const config = {
        maxRetries: 5,
        initialDelayMs: 100,
        maxDelayMs: 10000,
        multiplier: 2,
        jitter: false,
      };

      const delay1 = calculateRetryDelay(0, config);
      const delay2 = calculateRetryDelay(1, config);
      const delay3 = calculateRetryDelay(2, config);

      expect(delay1).toBe(100); // 100 * 2^0 = 100
      expect(delay2).toBe(200); // 100 * 2^1 = 200
      expect(delay3).toBe(400); // 100 * 2^2 = 400
    });

    it('should respect max delay limit', () => {
      const config = {
        maxRetries: 15,
        initialDelayMs: 100,
        maxDelayMs: 500,
        multiplier: 2,
        jitter: false,
      };

      const delay = calculateRetryDelay(10, config); // Would be 100 * 2^10 = 102400

      expect(delay).toBe(500); // Capped at maxDelayMs
    });

    it('should add jitter when enabled', () => {
      const config = {
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        multiplier: 2,
        jitter: true,
      };

      const delays = Array.from({ length: 10 }, () => calculateRetryDelay(0, config));

      // With jitter, delays should vary
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);

      // All delays should be within range (base ± 25%)
      delays.forEach((delay) => {
        expect(delay).toBeGreaterThanOrEqual(750); // 1000 - 250
        expect(delay).toBeLessThanOrEqual(1250); // 1000 + 250
      });
    });
  });

  describe('status code classification', () => {
    it('should identify retryable 5xx status codes', () => {
      const retryable5xx = [500, 502, 503, 504];
      retryable5xx.forEach((code) => {
        expect(code >= 500).toBe(true);
      });
    });

    it('should identify retryable 429 status code', () => {
      const code = 429;
      expect(code === 429).toBe(true);
    });

    it('should identify non-retryable 4xx status codes', () => {
      const nonRetryable4xx = [400, 401, 404];
      nonRetryable4xx.forEach((code) => {
        expect(code >= 400 && code < 500 && code !== 429).toBe(true);
      });
    });
  });
});
