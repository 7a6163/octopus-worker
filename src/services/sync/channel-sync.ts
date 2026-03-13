/**
 * Channel Model Auto-Sync Service
 *
 * Fetches available models from upstream LLM providers and updates
 * channel model lists. Supports OpenAI, Anthropic, and Gemini APIs.
 */

import type { Bindings } from '@/types';
import type { Channel, CustomHeader } from '@/types/channel';
import { OutboundType } from '@/types/channel';
import { updateSetting } from '@/services/db/settings';
import { autoGroupChannel } from '@/services/sync/auto-group';
import { AutoGroupType } from '@/types/channel';

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Sync models for all channels that have auto_sync enabled.
 */
export async function syncChannelModels(env: Bindings): Promise<void> {
  const channels = await getAutoSyncChannels(env.DB);

  if (channels.length === 0) {
    console.log('No channels with auto_sync enabled');
    return;
  }

  console.log(`Syncing models for ${channels.length} channels`);

  for (const channel of channels) {
    try {
      await syncSingleChannel(env, channel);
    } catch (err) {
      console.error(`Failed to sync channel ${channel.id} (${channel.name}):`, err);
    }
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  await updateSetting(env.DB, 'last_sync_time', timestamp);

  console.log('Channel model sync completed');
}

/**
 * Sync a single channel: fetch upstream models, filter, update DB, and auto-group.
 */
async function syncSingleChannel(env: Bindings, channel: Channel): Promise<void> {
  if (channel.keys.length === 0 || channel.baseUrls.length === 0) {
    console.warn(`Channel ${channel.id} has no keys or base URLs, skipping`);
    return;
  }

  const firstUrl = channel.baseUrls[0];
  const firstKey = channel.keys[0];
  if (!firstUrl || !firstKey) return;
  const baseUrl = firstUrl.url;
  const key = firstKey.channelKey;

  const models = await fetchModelsFromUpstream(
    baseUrl,
    key,
    channel.type,
    channel.customHeader
  );

  if (models.length === 0) {
    console.warn(`No models returned for channel ${channel.id}`);
    return;
  }

  // Apply regex filter if configured
  const filteredModels = channel.matchRegex
    ? filterModelsByRegex(models, channel.matchRegex)
    : models;

  if (filteredModels.length === 0) {
    console.warn(`All models filtered out for channel ${channel.id}`);
    return;
  }

  const modelList = filteredModels.join(',');

  // Update channel model list in DB
  await env.DB
    .prepare('UPDATE channels SET model = ? WHERE id = ?')
    .bind(modelList, channel.id)
    .run();

  console.log(`Channel ${channel.id}: synced ${filteredModels.length} models`);

  // Auto-group if enabled
  if (channel.autoGroup !== AutoGroupType.None) {
    const updatedChannel: Channel = { ...channel, model: modelList };
    await autoGroupChannel(env.DB, updatedChannel);
  }
}

/**
 * Fetch available models from an upstream provider.
 */
export async function fetchModelsFromUpstream(
  baseUrl: string,
  key: string,
  type: OutboundType,
  customHeaders: readonly CustomHeader[]
): Promise<readonly string[]> {
  const normalizedBase = baseUrl.replace(/\/+$/, '');

  switch (type) {
    case OutboundType.OpenAIChat:
    case OutboundType.OpenAIResponse:
    case OutboundType.OpenAIEmbedding:
      return fetchOpenAIModels(normalizedBase, key, customHeaders);

    case OutboundType.Anthropic:
      return fetchAnthropicModels(normalizedBase, key, customHeaders);

    case OutboundType.Gemini:
      return fetchGeminiModels(normalizedBase, key, customHeaders);

    default:
      console.warn(`Unsupported channel type ${type} for model fetching`);
      return [];
  }
}

/**
 * Fetch models from an OpenAI-compatible /models endpoint.
 */
async function fetchOpenAIModels(
  baseUrl: string,
  key: string,
  customHeaders: readonly CustomHeader[]
): Promise<readonly string[]> {
  const headers = buildHeaders(customHeaders, {
    Authorization: `Bearer ${key}`,
  });

  const response = await fetchWithTimeout(`${baseUrl}/models`, { headers });

  if (!response.ok) {
    throw new Error(`OpenAI models API returned ${response.status}`);
  }

  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  const data = body.data ?? [];

  return data
    .map((m) => m.id ?? '')
    .filter((id) => id.length > 0);
}

/**
 * Fetch models from Anthropic /models endpoint with pagination.
 */
async function fetchAnthropicModels(
  baseUrl: string,
  key: string,
  customHeaders: readonly CustomHeader[]
): Promise<readonly string[]> {
  const models: string[] = [];
  let afterId: string | undefined;

  for (;;) {
    const url = new URL(`${baseUrl}/models`);
    url.searchParams.set('limit', '100');
    if (afterId) {
      url.searchParams.set('after_id', afterId);
    }

    const headers = buildHeaders(customHeaders, {
      'X-Api-Key': key,
      'Anthropic-Version': '2023-06-01',
    });

    const response = await fetchWithTimeout(url.toString(), { headers });

    if (!response.ok) {
      throw new Error(`Anthropic models API returned ${response.status}`);
    }

    const body = (await response.json()) as {
      data?: Array<{ id?: string }>;
      has_more?: boolean;
      last_id?: string;
    };

    const data = body.data ?? [];
    for (const m of data) {
      if (m.id) {
        models.push(m.id);
      }
    }

    if (!body.has_more || data.length === 0) {
      break;
    }

    afterId = body.last_id ?? data[data.length - 1]?.id;
    if (!afterId) {
      break;
    }
  }

  return models;
}

/**
 * Fetch models from Gemini /models endpoint with pagination.
 */
async function fetchGeminiModels(
  baseUrl: string,
  key: string,
  customHeaders: readonly CustomHeader[]
): Promise<readonly string[]> {
  const models: string[] = [];
  let pageToken: string | undefined;

  for (;;) {
    const url = new URL(`${baseUrl}/models`);
    url.searchParams.set('key', key);
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const headers = buildHeaders(customHeaders, {
      'X-Goog-Api-Key': key,
    });

    const response = await fetchWithTimeout(url.toString(), { headers });

    if (!response.ok) {
      throw new Error(`Gemini models API returned ${response.status}`);
    }

    const body = (await response.json()) as {
      models?: Array<{ name?: string }>;
      nextPageToken?: string;
    };

    const data = body.models ?? [];
    for (const m of data) {
      if (m.name) {
        // Strip "models/" prefix from Gemini model names
        const name = m.name.startsWith('models/')
          ? m.name.slice('models/'.length)
          : m.name;
        models.push(name);
      }
    }

    if (!body.nextPageToken || data.length === 0) {
      break;
    }

    pageToken = body.nextPageToken;
  }

  return models;
}

/**
 * Build a Headers object from custom headers and default headers.
 * Custom headers take precedence over defaults.
 */
function buildHeaders(
  customHeaders: readonly CustomHeader[],
  defaults: Record<string, string>
): Record<string, string> {
  const result = { ...defaults };
  for (const h of customHeaders) {
    if (h.headerKey && h.headerValue) {
      result[h.headerKey] = h.headerValue;
    }
  }
  return result;
}

/**
 * Fetch with a timeout to avoid hanging on unresponsive upstreams.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Filter model names through a regex pattern.
 * Returns only models matching the pattern.
 */
function filterModelsByRegex(
  models: readonly string[],
  pattern: string
): readonly string[] {
  try {
    const regex = new RegExp(pattern);
    return models.filter((m) => regex.test(m));
  } catch (err) {
    console.error(`Invalid match_regex pattern: ${pattern}`, err);
    return models;
  }
}

/**
 * Get all channels with auto_sync enabled (including keys and base URLs).
 */
async function getAutoSyncChannels(db: D1Database): Promise<readonly Channel[]> {
  const channelsResult = await db
    .prepare(
      `SELECT id, name, type, enabled, base_urls, model, custom_model,
              proxy, auto_sync, auto_group, custom_header, match_regex
       FROM channels
       WHERE auto_sync = 1 AND enabled = 1
       ORDER BY id ASC`
    )
    .all<{
      id: number;
      name: string;
      type: number;
      enabled: number;
      base_urls: string;
      model: string;
      custom_model: string;
      proxy: number;
      auto_sync: number;
      auto_group: number;
      custom_header: string;
      match_regex: string | null;
    }>();

  const channels: Channel[] = [];

  for (const ch of channelsResult.results ?? []) {
    // Fetch first enabled key for this channel
    const keyResult = await db
      .prepare(
        `SELECT id, channel_id, enabled, channel_key, status_code,
                last_use_timestamp, total_cost, remark
         FROM channel_keys
         WHERE channel_id = ? AND enabled = 1
         ORDER BY total_cost ASC
         LIMIT 1`
      )
      .bind(ch.id)
      .first<{
        id: number;
        channel_id: number;
        enabled: number;
        channel_key: string;
        status_code: number;
        last_use_timestamp: number;
        total_cost: number;
        remark: string;
      }>();

    const keys = keyResult
      ? [
          {
            id: keyResult.id,
            channelId: keyResult.channel_id,
            enabled: keyResult.enabled === 1,
            channelKey: keyResult.channel_key,
            statusCode: keyResult.status_code,
            lastUseTimeStamp: keyResult.last_use_timestamp,
            totalCost: keyResult.total_cost,
            remark: keyResult.remark,
          },
        ]
      : [];

    channels.push({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      enabled: ch.enabled === 1,
      baseUrls: JSON.parse(ch.base_urls),
      keys,
      model: ch.model,
      customModel: ch.custom_model,
      proxy: ch.proxy === 1,
      autoSync: ch.auto_sync === 1,
      autoGroup: ch.auto_group,
      customHeader: JSON.parse(ch.custom_header),
      matchRegex: ch.match_regex ?? undefined,
    });
  }

  return channels;
}
