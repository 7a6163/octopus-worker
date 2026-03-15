/**
 * Relay core handler
 * Corresponds to the original Go project's internal/relay/relay.go
 *
 * Core features:
 * 1. Parse client requests
 * 2. Channel selection and load balancing
 * 3. Forward requests to upstream APIs
 * 4. Handle responses (streaming/non-streaming)
 * 5. Retry and fault tolerance
 */

import type { Context } from 'hono';
import { getBalancer } from '@/services/balancer/interface';
import { getCachedChannel } from '@/services/cache/channel';
import { getCachedGroupByModel } from '@/services/cache/group';
import {
  type CircuitBreakerSettings,
  isTripped,
  recordFailure,
  recordSuccess,
  SETTING_KEY_CIRCUIT_BREAKER_COOLDOWN,
  SETTING_KEY_CIRCUIT_BREAKER_MAX_COOLDOWN,
  SETTING_KEY_CIRCUIT_BREAKER_THRESHOLD,
} from '@/services/circuit-breaker/circuit-breaker';
import { updateChannelKeyStatus } from '@/services/db/channel';
import { getNumberSetting } from '@/services/db/settings';
import { createRelayLog } from '@/services/log/relay-log';
import { calculateCost } from '@/services/pricing/calculator';
import { getInboundTransformer, getOutboundTransformer } from '@/services/transformer';
import type {
  InboundTransformer,
  InboundType,
  OutboundTransformer,
} from '@/services/transformer/interface';
import type { Bindings, Variables } from '@/types';
import type { BaseUrl, Channel, ChannelKey } from '@/types/channel';
import type { InternalLLMRequest } from '@/types/llm';

const MAX_ROUNDS = 3; // Maximum retry rounds

/**
 * Relay handler main function
 */
export async function relayHandler(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  inboundType: InboundType
) {
  // 1. Parse request
  const body = await c.req.arrayBuffer();
  const inAdapter = getInboundTransformer(inboundType);

  let internalRequest: InternalLLMRequest;
  try {
    internalRequest = await inAdapter.transformRequest(body);
  } catch (err) {
    return c.json(
      {
        error: {
          message: (err as Error).message,
          type: 'invalid_request_error',
        },
      },
      400
    );
  }

  // 2. Validate model is specified
  if (!internalRequest.model) {
    return c.json(
      {
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
        },
      },
      400
    );
  }

  // 3. Check API key supported models (TODO: Phase 2 read from DB)
  const supportedModels = c.get('supportedModels');
  if (supportedModels) {
    const models = supportedModels.split(',').map((m) => m.trim());
    if (!models.includes(internalRequest.model)) {
      return c.json(
        {
          error: {
            message: 'model not supported by this API key',
            type: 'invalid_request_error',
          },
        },
        403
      );
    }
  }

  // 4. Get model group (from cache/DB)
  const group = await getCachedGroupByModel(c.env.CACHE, c.env.DB, internalRequest.model);

  if (!group || group.items.length === 0) {
    return c.json(
      {
        error: {
          message: `model not found: ${internalRequest.model}`,
          type: 'model_not_found_error',
        },
      },
      404
    );
  }

  // 5. Initialize statistics
  const apiKeyId = c.get('apiKeyId');
  const requestModel = internalRequest.model;
  console.log(`Relay request: model=${requestModel}, apiKeyId=${apiKeyId}`);

  // 6. Load circuit breaker settings (read once to avoid DB queries per attempt)
  const cbSettings = await loadCircuitBreakerSettings(c.env.DB);

  // 7. Get load balancer
  const balancer = getBalancer(group.mode, c.env);

  // 8. Retry logic
  let lastError: Error | null = null;
  const itemCount = group.items.length;
  const excludeIds = new Set<number>(); // Track failed GroupItem IDs

  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (let i = 0; i < itemCount; i++) {
      const attemptStart = Date.now();

      // Select GroupItem using load balancer
      const item = await balancer.selectNext(group, excludeIds);
      if (!item) {
        lastError = new Error('no available items');
        break;
      }

      // Get channel (from cache/DB)
      const channel = await getCachedChannel(c.env.CACHE, c.env.DB, item.channelId);

      if (!channel || !channel.enabled) {
        lastError = new Error(`channel ${item.channelId} is disabled or not found`);
        excludeIds.add(item.id);
        continue;
      }

      // Select key
      const usedKey = selectChannelKey(channel);
      if (!usedKey) {
        lastError = new Error('no available key');
        excludeIds.add(item.id);
        continue;
      }

      // Circuit breaker check: skip tripped channel+key+model combinations
      const trippedResult = isTripped(channel.id, usedKey.id, item.modelName, cbSettings);
      if (trippedResult.tripped) {
        const remainMsg =
          trippedResult.remainingMs > 0
            ? `, remaining cooldown: ${Math.ceil(trippedResult.remainingMs / 1000)}s`
            : '';
        console.log(
          `Circuit breaker tripped: channel=${channel.name}, key=${usedKey.id}, ` +
            `model=${item.modelName}${remainMsg}`
        );
        continue; // Don't add to excludeIds so other keys still have a chance
      }

      // Get outbound transformer
      const outAdapter = getOutboundTransformer(channel.type);
      if (!outAdapter) {
        lastError = new Error(`unsupported channel type: ${channel.type}`);
        excludeIds.add(item.id);
        continue;
      }

      console.log(
        `Forwarding: model=${requestModel}, channel=${channel.name}, ` +
          `actualModel=${item.modelName}, round=${round + 1}/${MAX_ROUNDS}, ` +
          `attempt=${i + 1}/${itemCount}`
      );

      // Create request copy with actual model name (don't mutate the original)
      const requestForChannel = { ...internalRequest, model: item.modelName };

      try {
        // Forward request
        const result = await forwardRequest(
          c,
          inAdapter,
          outAdapter,
          requestForChannel,
          channel,
          usedKey,
          group.firstTokenTimeOut
        );

        if (result.success) {
          // Success -- record to circuit breaker
          recordSuccess(channel.id, usedKey.id, item.modelName);

          const attemptDuration = Date.now() - attemptStart;
          console.log(
            `Success: channel=${channel.name}, duration=${attemptDuration}ms, ` +
              `statusCode=${result.statusCode}`
          );

          // Update key status in DB
          await updateChannelKeyStatus(
            c.env.DB,
            usedKey.id,
            result.statusCode || 200,
            usedKey.totalCost
          );

          // Record statistics
          try {
            await recordStatistics(c.env, {
              apiKeyId: apiKeyId || 0,
              channelId: channel.id,
              channelName: channel.name,
              channelKeyId: usedKey.id,
              requestModelName: requestForChannel.model,
              success: true,
              waitTime: attemptDuration,
              tokenUsage: result.tokenUsage,
            });
          } catch (statsErr) {
            console.error('Failed to record statistics:', statsErr);
          }

          return result.response!;
        } else {
          throw result.error;
        }
      } catch (err) {
        // Failure -- record to circuit breaker
        recordFailure(channel.id, usedKey.id, item.modelName, cbSettings);

        const attemptDuration = Date.now() - attemptStart;
        const error = err as any;
        console.error(
          `Failed: channel=${channel.name}, duration=${attemptDuration}ms, ` +
            `error=${error.message}`
        );

        lastError = new Error(`channel ${channel.name} failed: ${error.message}`);

        // Update key status in DB (especially for 429 errors)
        const statusCode = error.statusCode || 500;
        await updateChannelKeyStatus(c.env.DB, usedKey.id, statusCode, usedKey.totalCost);

        // Mark as failed
        excludeIds.add(item.id);
      }
    }
  }

  // All channels failed
  const errorMessage = lastError?.message || 'all channels failed';
  console.error(`All channels failed after ${MAX_ROUNDS} rounds:`, errorMessage);

  // Record failure statistics
  try {
    await recordStatistics(c.env, {
      apiKeyId: apiKeyId || 0,
      channelId: 0,
      channelName: 'unknown',
      channelKeyId: 0,
      requestModelName: requestModel,
      success: false,
      waitTime: 0,
      errorMessage,
    });
  } catch (statsErr) {
    console.error('Failed to record failure statistics:', statsErr);
  }

  return c.json(
    {
      error: {
        message: errorMessage,
        type: 'service_unavailable_error',
      },
    },
    502
  );
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * Forward request to upstream API
 */
async function forwardRequest(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  inAdapter: InboundTransformer,
  outAdapter: OutboundTransformer,
  internalRequest: InternalLLMRequest,
  channel: Channel,
  usedKey: ChannelKey,
  firstTokenTimeOutSec: number
): Promise<{
  success: boolean;
  response?: Response;
  statusCode?: number;
  error?: Error;
  tokenUsage?: TokenUsage;
}> {
  // Build outbound request
  const baseUrl = selectBestBaseUrl(channel.baseUrls);
  const outboundRequest = await outAdapter.transformRequest(
    internalRequest,
    baseUrl,
    usedKey.channelKey
  );

  // Copy request headers
  copyHeaders(c.req.raw, outboundRequest, channel.customHeader);

  // Send request
  let response: Response;
  try {
    response = await fetch(outboundRequest);
  } catch (err) {
    return {
      success: false,
      error: new Error(`fetch failed: ${(err as Error).message}`),
    };
  }

  // Check status code
  if (response.status < 200 || response.status >= 300) {
    const body = await response.text();
    return {
      success: false,
      statusCode: response.status,
      error: new Error(`upstream error: ${response.status}: ${body.slice(0, 200)}`),
    };
  }

  // Handle response
  if (internalRequest.stream) {
    return handleStreamResponse(c, response, inAdapter, outAdapter, firstTokenTimeOutSec);
  } else {
    return handleNonStreamResponse(c, response, inAdapter, outAdapter);
  }
}

/**
 * Handle streaming response
 */
async function handleStreamResponse(
  _c: Context<{ Bindings: Bindings; Variables: Variables }>,
  response: Response,
  inAdapter: InboundTransformer,
  outAdapter: OutboundTransformer,
  firstTokenTimeOutSec: number
): Promise<{
  success: boolean;
  response?: Response;
  statusCode?: number;
  error?: Error;
  tokenUsage?: TokenUsage;
}> {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    const body = await response.text();
    return {
      success: false,
      statusCode: response.status,
      error: new Error(
        `upstream returned non-SSE content-type: ${contentType}: ${body.slice(0, 200)}`
      ),
    };
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let aborted = false;

  // Use a Promise to await first token or timeout, resolving the race condition
  const firstTokenResult = await new Promise<{ received: boolean }>((resolve) => {
    let resolved = false;
    let firstToken = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (firstTokenTimeOutSec > 0) {
      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          aborted = true;
          resolve({ received: false });
          writer.close().catch(() => {});
        }
      }, firstTokenTimeOutSec * 1000);
    }

    // Process SSE stream
    (async () => {
      const reader = response.body?.getReader();
      if (!reader) {
        await writer.close().catch(() => {});
        if (!resolved) {
          resolved = true;
          resolve({ received: false });
        }
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (!data || data.trim() === '' || data.trim() === '{}') continue;

            try {
              const internalStream = await outAdapter.transformStream(encoder.encode(data));
              if (!internalStream) continue;

              const outStream = await inAdapter.transformStream(internalStream);
              if (!outStream) continue;

              if (firstToken) {
                firstToken = false;
                if (timer) {
                  clearTimeout(timer);
                  timer = null;
                }
                if (!resolved) {
                  resolved = true;
                  resolve({ received: true });
                }
              }

              if (!aborted) await writer.write(outStream);
            } catch (err) {
              console.error('Stream transform error:', err);
            }
          }
        }
      } finally {
        if (!aborted) await writer.close().catch(() => {});
        // If no data was ever written and no timeout, resolve as success (empty stream)
        if (!resolved) {
          resolved = true;
          resolve({ received: true });
        }
      }
    })();

    // If no timeout configured, don't block -- resolve immediately
    if (firstTokenTimeOutSec <= 0 && !resolved) {
      resolved = true;
      resolve({ received: true });
    }
  });

  if (!firstTokenResult.received) {
    return {
      success: false,
      error: new Error(`first token timeout (${firstTokenTimeOutSec}s)`),
    };
  }

  return {
    success: true,
    statusCode: response.status,
    response: new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    }),
  };
}

/**
 * Handle non-streaming response
 */
async function handleNonStreamResponse(
  _c: Context<{ Bindings: Bindings; Variables: Variables }>,
  response: Response,
  inAdapter: InboundTransformer,
  outAdapter: OutboundTransformer
): Promise<{
  success: boolean;
  response?: Response;
  statusCode?: number;
  error?: Error;
  tokenUsage?: TokenUsage;
}> {
  try {
    // Transform response: upstream -> internal -> client
    const internalResponse = await outAdapter.transformResponse(response);
    const outResponse = await inAdapter.transformResponse(internalResponse);

    // Extract token usage
    let tokenUsage: TokenUsage | undefined;
    if (internalResponse.usage) {
      tokenUsage = {
        promptTokens: internalResponse.usage.promptTokens || 0,
        completionTokens: internalResponse.usage.completionTokens || 0,
        cacheReadTokens: internalResponse.usage.cacheReadInputTokens || 0,
        cacheCreationTokens: internalResponse.usage.cacheCreationInputTokens || 0,
      };
    }

    return {
      success: true,
      statusCode: response.status,
      response: new Response(outResponse, {
        headers: { 'Content-Type': 'application/json' },
      }),
      tokenUsage,
    };
  } catch (err) {
    return {
      success: false,
      statusCode: response.status,
      error: err as Error,
    };
  }
}

// ==================== Helper Functions ====================

/**
 * Select the base URL with the lowest latency
 */
function selectBestBaseUrl(baseUrls: BaseUrl[]): string {
  if (!baseUrls || baseUrls.length === 0) return '';

  let best = baseUrls[0];
  if (!best) return '';

  for (const bu of baseUrls) {
    if (bu.delay < best.delay) {
      best = bu;
    }
  }

  return best.url;
}

/**
 * Select an available channel key
 */
function selectChannelKey(channel: Channel): ChannelKey | null {
  const nowSec = Math.floor(Date.now() / 1000);
  let best: ChannelKey | null = null;

  for (const key of channel.keys) {
    if (!key.enabled || !key.channelKey) continue;

    // 429 cooldown check (5 minutes)
    if (key.statusCode === 429 && key.lastUseTimeStamp > 0) {
      if (nowSec - key.lastUseTimeStamp < 300) continue;
    }

    // Select the key with the lowest cost
    if (!best || key.totalCost < best.totalCost) {
      best = key;
    }
  }

  return best;
}

/**
 * Copy request headers
 */
function copyHeaders(
  inRequest: Request,
  outRequest: Request,
  customHeaders: Array<{ headerKey: string; headerValue: string }>
) {
  // Headers that should not be forwarded
  const skipHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'authorization',
    'host',
    'content-length',
    'content-type',
    'accept',
    'accept-encoding',
  ]);

  for (const [key, value] of inRequest.headers) {
    if (!skipHeaders.has(key.toLowerCase())) {
      outRequest.headers.set(key, value);
    }
  }

  // Custom headers
  for (const header of customHeaders) {
    outRequest.headers.set(header.headerKey, header.headerValue);
  }
}

/**
 * Load circuit breaker settings (from DB, with defaults)
 */
async function loadCircuitBreakerSettings(db: D1Database): Promise<CircuitBreakerSettings> {
  const [threshold, cooldownSec, maxCooldownSec] = await Promise.all([
    getNumberSetting(db, SETTING_KEY_CIRCUIT_BREAKER_THRESHOLD, 5),
    getNumberSetting(db, SETTING_KEY_CIRCUIT_BREAKER_COOLDOWN, 60),
    getNumberSetting(db, SETTING_KEY_CIRCUIT_BREAKER_MAX_COOLDOWN, 600),
  ]);

  return {
    threshold: threshold > 0 ? threshold : 5,
    cooldownSec: cooldownSec > 0 ? cooldownSec : 60,
    maxCooldownSec: maxCooldownSec > 0 ? maxCooldownSec : 600,
  };
}

/**
 * Record statistics
 */
async function recordStatistics(
  env: Bindings,
  data: {
    apiKeyId: number;
    channelId: number;
    channelName: string;
    channelKeyId: number;
    requestModelName: string;
    success: boolean;
    waitTime: number;
    tokenUsage?: TokenUsage;
    errorMessage?: string;
  }
) {
  const { tokenUsage } = data;
  const promptTokens = tokenUsage?.promptTokens || 0;
  const completionTokens = tokenUsage?.completionTokens || 0;
  const cacheReadTokens = tokenUsage?.cacheReadTokens || 0;
  const cacheCreationTokens = tokenUsage?.cacheCreationTokens || 0;

  // Calculate cost
  const costCalculation = await calculateCost(
    env.DB,
    env.CACHE,
    data.requestModelName,
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheCreationTokens
  );

  // Record to StatsAggregator DO
  try {
    const doId = env.STATS_AGGREGATOR.idFromName('global');
    const doStub = env.STATS_AGGREGATOR.get(doId);

    await doStub.fetch('https://internal/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: data.success,
        promptTokens,
        completionTokens,
        cost: costCalculation.totalCost,
      }),
    });
  } catch (doErr) {
    console.error('Failed to record to StatsAggregator:', doErr);
    // Don't block the request
  }

  // Record to relay log
  try {
    await createRelayLog(env.DB, {
      time: Math.floor(Date.now() / 1000),
      requestModelName: data.requestModelName,
      channelId: data.channelId,
      channelName: data.channelName,
      channelKeyId: data.channelKeyId,
      apiKeyId: data.apiKeyId,
      promptTokens,
      completionTokens,
      cacheReadTokens,
      cacheCreationTokens,
      inputCost: costCalculation.inputCost,
      outputCost: costCalculation.outputCost,
      cacheReadCost: costCalculation.cacheReadCost,
      cacheCreationCost: costCalculation.cacheCreationCost,
      totalCost: costCalculation.totalCost,
      waitTime: data.waitTime,
      success: data.success,
      errorMessage: data.errorMessage || '',
    });
  } catch (logErr) {
    console.error('Failed to create relay log:', logErr);
    // Don't block the request
  }
}
