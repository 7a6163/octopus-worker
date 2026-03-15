/**
 * LLM cost calculation service
 * Corresponds to internal/service/pricing.go in the original Go project
 *
 * Features:
 * - Read pricing from the llm_infos table
 * - Calculate cost based on token usage
 * - Cache pricing information
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

/**
 * Pricing information interface
 */
export interface PricingInfo {
  name: string;
  input: number; // Price per million tokens (USD)
  output: number; // Price per million tokens (USD)
  cacheRead: number; // Cache read price per million tokens
  cacheWrite: number; // Cache write price per million tokens
}

/**
 * Cost calculation result
 */
export interface CostCalculation {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheCreationCost: number;
  totalCost: number;
}

const PRICE_CACHE_TTL = 3600; // 1 hour
const PRICE_CACHE_PREFIX = 'pricing:';

/**
 * Get pricing info from D1
 */
async function getPricingFromDB(db: D1Database, modelName: string): Promise<PricingInfo | null> {
  try {
    const result = await db
      .prepare(
        `SELECT name, input, output, cache_read, cache_write
         FROM llm_infos
         WHERE name = ?`
      )
      .bind(modelName)
      .first<{
        name: string;
        input: number;
        output: number;
        cache_read: number;
        cache_write: number;
      }>();

    if (!result) {
      return null;
    }

    return {
      name: result.name,
      input: result.input,
      output: result.output,
      cacheRead: result.cache_read,
      cacheWrite: result.cache_write,
    };
  } catch (err) {
    console.error('Failed to get pricing from DB:', err);
    return null;
  }
}

/**
 * Get pricing info (with cache)
 */
export async function getPricing(
  db: D1Database,
  kv: KVNamespace,
  modelName: string
): Promise<PricingInfo | null> {
  const cacheKey = `${PRICE_CACHE_PREFIX}${modelName}`;

  // 1. Try reading from cache
  try {
    const cached = await kv.get(cacheKey, 'text');
    if (cached && cached !== '__NULL__') {
      return JSON.parse(cached) as PricingInfo;
    }
    if (cached === '__NULL__') {
      return null;
    }
  } catch (err) {
    console.error('Failed to read pricing from cache:', err);
  }

  // 2. Read from DB
  const pricing = await getPricingFromDB(db, modelName);

  // 3. Write to cache
  try {
    if (pricing === null) {
      await kv.put(cacheKey, '__NULL__', { expirationTtl: PRICE_CACHE_TTL });
    } else {
      await kv.put(cacheKey, JSON.stringify(pricing), { expirationTtl: PRICE_CACHE_TTL });
    }
  } catch (err) {
    console.error('Failed to write pricing to cache:', err);
  }

  return pricing;
}

/**
 * Calculate cost
 */
export async function calculateCost(
  db: D1Database,
  kv: KVNamespace,
  modelName: string,
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0
): Promise<CostCalculation> {
  // Get pricing info
  const pricing = await getPricing(db, kv, modelName);

  if (!pricing) {
    // If no pricing info available, return 0
    console.warn(`No pricing info for model: ${modelName}`);
    return {
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheCreationCost: 0,
      totalCost: 0,
    };
  }

  // Calculate cost (price is per million tokens)
  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheRead;
  const cacheCreationCost = (cacheCreationTokens / 1_000_000) * pricing.cacheWrite;

  const totalCost = inputCost + outputCost + cacheReadCost + cacheCreationCost;

  return {
    inputCost: Math.round(inputCost * 1_000_000) / 1_000_000, // Round to 6 decimal places
    outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
    cacheReadCost: Math.round(cacheReadCost * 1_000_000) / 1_000_000,
    cacheCreationCost: Math.round(cacheCreationCost * 1_000_000) / 1_000_000,
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
  };
}

/**
 * Batch upsert pricing information
 */
export async function batchUpsertPricing(db: D1Database, pricings: PricingInfo[]): Promise<void> {
  if (pricings.length === 0) {
    return;
  }

  try {
    const statements = pricings.map((pricing) =>
      db
        .prepare(
          `INSERT INTO llm_infos (name, input, output, cache_read, cache_write)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             input = excluded.input,
             output = excluded.output,
             cache_read = excluded.cache_read,
             cache_write = excluded.cache_write`
        )
        .bind(pricing.name, pricing.input, pricing.output, pricing.cacheRead, pricing.cacheWrite)
    );

    await db.batch(statements);
    console.log(`Upserted ${pricings.length} pricing entries`);
  } catch (err) {
    console.error('Failed to batch upsert pricing:', err);
  }
}

/**
 * Invalidate pricing cache
 */
export async function invalidatePricingCache(kv: KVNamespace, modelName: string): Promise<void> {
  const cacheKey = `${PRICE_CACHE_PREFIX}${modelName}`;
  try {
    await kv.delete(cacheKey);
  } catch (err) {
    console.error('Failed to invalidate pricing cache:', err);
  }
}
