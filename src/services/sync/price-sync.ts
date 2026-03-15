/**
 * Model Price Sync Service
 *
 * Fetches LLM pricing data from models.dev and upserts into the llm_infos table.
 * Runs on an hourly cron schedule.
 */

import { updateSetting } from '@/services/db/settings';
import { batchUpsertPricing, type PricingInfo } from '@/services/pricing/calculator';
import type { Bindings } from '@/types';

/** Providers supported by this system */
const SUPPORTED_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'alibaba',
  'zhipuai',
  'minimax',
  'moonshotai',
  'v0',
] as const;

const MODELS_API_URL = 'https://models.dev/api.json';
const D1_BATCH_LIMIT = 50;

/**
 * Shape of a single model entry from models.dev API
 */
interface ModelsDevModelEntry {
  readonly input_per_million?: number;
  readonly output_per_million?: number;
  readonly cache_read_per_million?: number;
  readonly cache_write_per_million?: number;
}

/**
 * Shape of a provider entry from models.dev API
 */
interface ModelsDevProviderEntry {
  readonly models?: Record<string, ModelsDevModelEntry>;
}

type ModelsDevResponse = Record<string, ModelsDevProviderEntry>;

/**
 * Fetch pricing data from models.dev and upsert into D1 llm_infos table.
 * Returns the count of models synced.
 */
export async function syncModelPricing(env: Bindings): Promise<number> {
  const response = await fetch(MODELS_API_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch model pricing: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ModelsDevResponse;
  const pricings = extractPricings(data);

  if (pricings.length === 0) {
    console.log('No pricing data found from models.dev');
    return 0;
  }

  // Batch upsert in groups of D1_BATCH_LIMIT
  const batches = splitIntoBatches(pricings, D1_BATCH_LIMIT);

  for (const batch of batches) {
    await batchUpsertPricing(env.DB, batch);
  }

  // Record sync timestamp
  const timestamp = Math.floor(Date.now() / 1000).toString();
  await updateSetting(env.DB, 'last_price_sync_time', timestamp);

  console.log(`Synced pricing for ${pricings.length} models`);
  return pricings.length;
}

/**
 * Extract PricingInfo entries from the models.dev response.
 * Filters to supported providers only.
 */
function extractPricings(data: ModelsDevResponse): readonly PricingInfo[] {
  const results: PricingInfo[] = [];

  for (const provider of SUPPORTED_PROVIDERS) {
    const providerData = data[provider];
    if (!providerData?.models) {
      continue;
    }

    for (const [modelName, modelData] of Object.entries(providerData.models)) {
      if (!modelData || typeof modelData !== 'object') {
        continue;
      }

      const input = modelData.input_per_million ?? 0;
      const output = modelData.output_per_million ?? 0;

      // Skip models with no pricing data at all
      if (input === 0 && output === 0) {
        continue;
      }

      results.push({
        name: modelName,
        input,
        output,
        cacheRead: modelData.cache_read_per_million ?? 0,
        cacheWrite: modelData.cache_write_per_million ?? 0,
      });
    }
  }

  return results;
}

/**
 * Split an array into batches of a given size.
 * Returns a new array of arrays without mutating the input.
 */
function splitIntoBatches<T>(items: readonly T[], batchSize: number): readonly T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}
