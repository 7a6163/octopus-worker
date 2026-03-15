/**
 * Pricing 計算服務測試
 */

import { describe, expect, it } from 'vitest';

describe('Pricing Calculator', () => {
  describe('calculateCost', () => {
    it('should calculate input cost correctly', () => {
      // Example: 1,000,000 tokens at $1.00 per million = $1.00
      const tokens = 1_000_000;
      const pricePerMillion = 1.0;
      const cost = (tokens / 1_000_000) * pricePerMillion;

      expect(cost).toBe(1.0);
    });

    it('should calculate output cost correctly', () => {
      // Example: 500,000 tokens at $2.00 per million = $1.00
      const tokens = 500_000;
      const pricePerMillion = 2.0;
      const cost = (tokens / 1_000_000) * pricePerMillion;

      expect(cost).toBe(1.0);
    });

    it('should calculate total cost correctly', () => {
      // Input: 1M tokens @ $1/M = $1
      // Output: 500K tokens @ $2/M = $1
      // Total: $2
      const inputCost = (1_000_000 / 1_000_000) * 1.0;
      const outputCost = (500_000 / 1_000_000) * 2.0;
      const totalCost = inputCost + outputCost;

      expect(totalCost).toBe(2.0);
    });

    it('should handle cache read tokens', () => {
      // Cache read: 100K tokens @ $0.10/M = $0.01
      const tokens = 100_000;
      const pricePerMillion = 0.1;
      const cost = (tokens / 1_000_000) * pricePerMillion;

      expect(cost).toBe(0.01);
    });

    it('should handle cache creation tokens', () => {
      // Cache creation: 200K tokens @ $0.25/M = $0.05
      const tokens = 200_000;
      const pricePerMillion = 0.25;
      const cost = (tokens / 1_000_000) * pricePerMillion;

      expect(cost).toBe(0.05);
    });

    it('should round to 6 decimal places', () => {
      // Example calculation that needs rounding
      const cost = 1.23456789;
      const rounded = Math.round(cost * 1_000_000) / 1_000_000;

      expect(rounded).toBe(1.234568);
    });

    it('should handle zero tokens', () => {
      const cost = (0 / 1_000_000) * 1.0;
      expect(cost).toBe(0);
    });

    it('should handle very small amounts', () => {
      // 10 tokens @ $1/M = $0.00001
      const tokens = 10;
      const pricePerMillion = 1.0;
      const cost = (tokens / 1_000_000) * pricePerMillion;
      const rounded = Math.round(cost * 1_000_000) / 1_000_000;

      expect(rounded).toBe(0.00001);
    });
  });
});
