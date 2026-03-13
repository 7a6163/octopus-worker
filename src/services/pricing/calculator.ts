/**
 * LLM 費用計算服務
 * 對應原始 Go 專案的 internal/service/pricing.go
 *
 * 功能：
 * - 從 llm_infos 表讀取價格
 * - 根據 Token 使用量計算費用
 * - 快取價格資訊
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

/**
 * 價格資訊介面
 */
export interface PricingInfo {
  name: string;
  input: number;          // 每百萬 Token 的價格（美元）
  output: number;         // 每百萬 Token 的價格（美元）
  cacheRead: number;      // Cache Read 每百萬 Token 的價格
  cacheWrite: number;     // Cache Write 每百萬 Token 的價格
}

/**
 * 費用計算結果
 */
export interface CostCalculation {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheCreationCost: number;
  totalCost: number;
}

const PRICE_CACHE_TTL = 3600; // 1 小時
const PRICE_CACHE_PREFIX = 'pricing:';

/**
 * 從 D1 獲取價格資訊
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
 * 獲取價格資訊（帶快取）
 */
export async function getPricing(
  db: D1Database,
  kv: KVNamespace,
  modelName: string
): Promise<PricingInfo | null> {
  const cacheKey = `${PRICE_CACHE_PREFIX}${modelName}`;

  // 1. 嘗試從快取讀取
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

  // 2. 從 DB 讀取
  const pricing = await getPricingFromDB(db, modelName);

  // 3. 寫入快取
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
 * 計算費用
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
  // 獲取價格資訊
  const pricing = await getPricing(db, kv, modelName);

  if (!pricing) {
    // 如果沒有價格資訊，返回 0
    console.warn(`No pricing info for model: ${modelName}`);
    return {
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheCreationCost: 0,
      totalCost: 0,
    };
  }

  // 計算費用（價格是每百萬 Token）
  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheRead;
  const cacheCreationCost = (cacheCreationTokens / 1_000_000) * pricing.cacheWrite;

  const totalCost = inputCost + outputCost + cacheReadCost + cacheCreationCost;

  return {
    inputCost: Math.round(inputCost * 1_000_000) / 1_000_000, // 保留 6 位小數
    outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
    cacheReadCost: Math.round(cacheReadCost * 1_000_000) / 1_000_000,
    cacheCreationCost: Math.round(cacheCreationCost * 1_000_000) / 1_000_000,
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
  };
}

/**
 * 批次插入或更新價格資訊
 */
export async function batchUpsertPricing(
  db: D1Database,
  pricings: PricingInfo[]
): Promise<void> {
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
 * 使價格快取失效
 */
export async function invalidatePricingCache(kv: KVNamespace, modelName: string): Promise<void> {
  const cacheKey = `${PRICE_CACHE_PREFIX}${modelName}`;
  try {
    await kv.delete(cacheKey);
  } catch (err) {
    console.error('Failed to invalidate pricing cache:', err);
  }
}
