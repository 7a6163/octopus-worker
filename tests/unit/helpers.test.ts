import { describe, test, expect } from 'vitest';
import {
  safeJsonParse,
  randomString,
  formatDate,
  today,
  isValidUrl,
  truncate,
} from '@/utils/helpers';

describe('Helper Functions', () => {
  test('safeJsonParse - valid JSON', () => {
    const result = safeJsonParse('{"key":"value"}', {});
    expect(result).toEqual({ key: 'value' });
  });

  test('safeJsonParse - invalid JSON', () => {
    const fallback = { default: true };
    const result = safeJsonParse('invalid json', fallback);
    expect(result).toEqual(fallback);
  });

  test('randomString - generates correct length', () => {
    const str = randomString(10);
    expect(str).toHaveLength(10);
    expect(/^[A-Za-z0-9]+$/.test(str)).toBe(true);
  });

  test('formatDate - formats correctly', () => {
    const date = new Date('2026-02-05');
    const result = formatDate(date);
    expect(result).toBe('20260205');
  });

  test('today - returns current date string', () => {
    const result = today();
    expect(result).toMatch(/^\d{8}$/);
  });

  test('isValidUrl - valid URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://localhost:8080')).toBe(true);
  });

  test('isValidUrl - invalid URLs', () => {
    expect(isValidUrl('not a url')).toBe(false);
    expect(isValidUrl('')).toBe(false);
  });

  test('truncate - truncates long strings', () => {
    const long = 'a'.repeat(100);
    const result = truncate(long, 10);
    expect(result).toBe('aaaaaaaaaa...');
    expect(result.length).toBe(13);
  });

  test('truncate - keeps short strings', () => {
    const short = 'short';
    const result = truncate(short, 10);
    expect(result).toBe('short');
  });
});
