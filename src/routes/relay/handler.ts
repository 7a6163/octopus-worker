/**
 * Relay 核心處理器
 * 對應原始 Go 專案的 internal/relay/relay.go
 *
 * 核心功能：
 * 1. 解析客戶端請求
 * 2. 選擇渠道與負載平衡
 * 3. 轉發請求到上游 API
 * 4. 處理回應（流式/非流式）
 * 5. 重試與容錯
 */

import type { Context } from 'hono';
import type { Bindings, Variables } from '@/types';
import type { InternalLLMRequest } from '@/types/llm';
import type { Channel, ChannelKey, BaseUrl } from '@/types/channel';
import { getInboundTransformer, getOutboundTransformer } from '@/services/transformer';
import type { InboundType } from '@/services/transformer/interface';
import { getCachedGroupByModel } from '@/services/cache/group';
import { getCachedChannel } from '@/services/cache/channel';
import { updateChannelKeyStatus } from '@/services/db/channel';
import { getBalancer } from '@/services/balancer/interface';
import { calculateCost } from '@/services/pricing/calculator';
import { createRelayLog } from '@/services/log/relay-log';
import {
  isTripped,
  recordSuccess,
  recordFailure,
  type CircuitBreakerSettings,
  SETTING_KEY_CIRCUIT_BREAKER_THRESHOLD,
  SETTING_KEY_CIRCUIT_BREAKER_COOLDOWN,
  SETTING_KEY_CIRCUIT_BREAKER_MAX_COOLDOWN,
} from '@/services/circuit-breaker/circuit-breaker';
import { getNumberSetting } from '@/services/db/settings';

const MAX_ROUNDS = 3; // 最大重試輪數

/**
 * Relay 處理器主函數
 */
export async function relayHandler(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  inboundType: InboundType
) {
  // 1. 解析請求
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

  // 2. 驗證模型存在
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

  // 3. 檢查 API Key 支援的模型（TODO: Phase 2 從 DB 讀取）
  const supportedModels = c.get('supportedModels');
  if (supportedModels) {
    const models = supportedModels.split(',');
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

  // 4. 獲取模型分組（從 Cache/DB 讀取）
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

  // 5. 初始化統計
  const apiKeyId = c.get('apiKeyId');
  const requestModel = internalRequest.model;
  console.log(`Relay request: model=${requestModel}, apiKeyId=${apiKeyId}`);

  // 6. 載入熔斷器設定（一次性讀取，避免每次 attempt 都查 DB）
  const cbSettings = await loadCircuitBreakerSettings(c.env.DB);

  // 7. 獲取負載平衡器
  const balancer = getBalancer(group.mode, c.env);

  // 8. 重試邏輯
  let lastError: Error | null = null;
  const itemCount = group.items.length;
  const excludeIds = new Set<number>(); // 記錄失敗的 GroupItem ID

  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (let i = 0; i < itemCount; i++) {
      const attemptStart = Date.now();

      // 使用負載平衡器選擇 GroupItem
      const item = await balancer.selectNext(group, excludeIds);
      if (!item) {
        lastError = new Error('no available items');
        break;
      }

      // 獲取渠道（從 Cache/DB 讀取）
      const channel = await getCachedChannel(c.env.CACHE, c.env.DB, item.channelId);

      if (!channel || !channel.enabled) {
        lastError = new Error(`channel ${item.channelId} is disabled or not found`);
        excludeIds.add(item.id);
        continue;
      }

      // 選擇 Key
      const usedKey = selectChannelKey(channel);
      if (!usedKey) {
        lastError = new Error('no available key');
        excludeIds.add(item.id);
        continue;
      }

      // 熔斷檢查：跳過已熔斷的 channel+key+model 組合
      const trippedResult = isTripped(channel.id, usedKey.id, item.modelName, cbSettings);
      if (trippedResult.tripped) {
        const remainMsg = trippedResult.remainingMs > 0
          ? `, remaining cooldown: ${Math.ceil(trippedResult.remainingMs / 1000)}s`
          : '';
        console.log(
          `Circuit breaker tripped: channel=${channel.name}, key=${usedKey.id}, ` +
            `model=${item.modelName}${remainMsg}`
        );
        continue; // 不標記 excludeIds，讓其他 key 仍有機會被選中
      }

      // 獲取出站轉換器
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

      // 設定實際模型名稱
      internalRequest.model = item.modelName;

      try {
        // 轉發請求
        const result = await forwardRequest(
          c,
          inAdapter,
          outAdapter,
          internalRequest,
          channel,
          usedKey,
          group.firstTokenTimeOut
        );

        if (result.success) {
          // 成功 — 記錄到熔斷器
          recordSuccess(channel.id, usedKey.id, item.modelName);

          const attemptDuration = Date.now() - attemptStart;
          console.log(
            `Success: channel=${channel.name}, duration=${attemptDuration}ms, ` +
              `statusCode=${result.statusCode}`
          );

          // 更新 Key 狀態到 DB
          await updateChannelKeyStatus(
            c.env.DB,
            usedKey.id,
            result.statusCode || 200,
            usedKey.totalCost
          );

          // 記錄統計
          try {
            await recordStatistics(
              c.env,
              {
                apiKeyId: apiKeyId || 0,
                channelId: channel.id,
                channelName: channel.name,
                channelKeyId: usedKey.id,
                requestModelName: internalRequest.model,
                success: true,
                waitTime: attemptDuration,
                tokenUsage: result.tokenUsage,
              }
            );
          } catch (statsErr) {
            console.error('Failed to record statistics:', statsErr);
          }

          return result.response!;
        } else {
          throw result.error;
        }
      } catch (err) {
        // 失敗 — 記錄到熔斷器
        recordFailure(channel.id, usedKey.id, item.modelName, cbSettings);

        const attemptDuration = Date.now() - attemptStart;
        const error = err as any;
        console.error(
          `Failed: channel=${channel.name}, duration=${attemptDuration}ms, ` +
            `error=${error.message}`
        );

        lastError = new Error(`channel ${channel.name} failed: ${error.message}`);

        // 更新 Key 狀態到 DB（特別是 429 錯誤）
        const statusCode = error.statusCode || 500;
        await updateChannelKeyStatus(c.env.DB, usedKey.id, statusCode, usedKey.totalCost);

        // 標記為失敗
        excludeIds.add(item.id);
      }
    }
  }

  // 所有渠道都失敗
  const errorMessage = lastError?.message || 'all channels failed';
  console.error(`All channels failed after ${MAX_ROUNDS} rounds:`, errorMessage);

  // 記錄失敗統計
  try {
    await recordStatistics(
      c.env,
      {
        apiKeyId: apiKeyId || 0,
        channelId: 0,
        channelName: 'unknown',
        channelKeyId: 0,
        requestModelName: internalRequest.model,
        success: false,
        waitTime: 0,
        errorMessage,
      }
    );
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
 * 轉發請求到上游 API
 */
async function forwardRequest(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  inAdapter: any,
  outAdapter: any,
  internalRequest: InternalLLMRequest,
  channel: Channel,
  usedKey: ChannelKey,
  firstTokenTimeOutSec: number
): Promise<{ success: boolean; response?: Response; statusCode?: number; error?: Error; tokenUsage?: TokenUsage }> {
  // 建構出站請求
  const baseUrl = selectBestBaseUrl(channel.baseUrls);
  const outboundRequest = await outAdapter.transformRequest(
    internalRequest,
    baseUrl,
    usedKey.channelKey
  );

  // 複製請求頭
  copyHeaders(c.req.raw, outboundRequest, channel.customHeader);

  // 發送請求
  let response: Response;
  try {
    response = await fetch(outboundRequest);
  } catch (err) {
    return {
      success: false,
      error: new Error(`fetch failed: ${(err as Error).message}`),
    };
  }

  // 檢查狀態碼
  if (response.status < 200 || response.status >= 300) {
    const body = await response.text();
    return {
      success: false,
      statusCode: response.status,
      error: new Error(`upstream error: ${response.status}: ${body.slice(0, 200)}`),
    };
  }

  // 處理回應
  if (internalRequest.stream) {
    return handleStreamResponse(
      c,
      response,
      inAdapter,
      outAdapter,
      firstTokenTimeOutSec
    );
  } else {
    return handleNonStreamResponse(c, response, inAdapter, outAdapter);
  }
}

/**
 * 處理流式回應
 */
async function handleStreamResponse(
  _c: Context<{ Bindings: Bindings; Variables: Variables }>,
  response: Response,
  inAdapter: any,
  outAdapter: any,
  firstTokenTimeOutSec: number
): Promise<{ success: boolean; response?: Response; statusCode?: number; error?: Error; tokenUsage?: TokenUsage }> {
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

  // 建立 TransformStream 處理 SSE
  let firstToken = true;
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // 設定首字超時
  if (firstTokenTimeOutSec > 0) {
    firstTokenTimer = setTimeout(() => {
      timedOut = true;
      writer.close();
    }, firstTokenTimeOutSec * 1000);
  }

  // 處理 SSE 流
  (async () => {
    const reader = response.body?.getReader();
    if (!reader) {
      await writer.close();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || timedOut) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            // 跳過空資料或 ping
            if (!data || data.trim() === '' || data.trim() === '{}') {
              continue;
            }

            // 轉換流式資料：上游 → 內部 → 客戶端
            try {
              const internalStream = await outAdapter.transformStream(encoder.encode(data));

              if (!internalStream) continue;

              const outStream = await inAdapter.transformStream(internalStream);
              if (!outStream) continue;

              // 記錄首字時間
              if (firstToken) {
                firstToken = false;
                if (firstTokenTimer) {
                  clearTimeout(firstTokenTimer);
                  firstTokenTimer = null;
                }
              }

              await writer.write(outStream);
            } catch (err) {
              console.error('Stream transform error:', err);
              // 繼續處理下一個事件
            }
          }
        }
      }
    } finally {
      await writer.close();
    }
  })();

  if (timedOut) {
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
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    }),
  };
}

/**
 * 處理非流式回應
 */
async function handleNonStreamResponse(
  _c: Context<{ Bindings: Bindings; Variables: Variables }>,
  response: Response,
  inAdapter: any,
  outAdapter: any
): Promise<{ success: boolean; response?: Response; statusCode?: number; error?: Error; tokenUsage?: TokenUsage }> {
  try {
    // 轉換回應：上游 → 內部 → 客戶端
    const internalResponse = await outAdapter.transformResponse(response);
    const outResponse = await inAdapter.transformResponse(internalResponse);

    // 提取 token 使用量
    let tokenUsage: TokenUsage | undefined;
    try {
      const responseData = JSON.parse(internalResponse);
      if (responseData.usage) {
        tokenUsage = {
          promptTokens: responseData.usage.prompt_tokens || 0,
          completionTokens: responseData.usage.completion_tokens || 0,
          cacheReadTokens: responseData.usage.cache_read_input_tokens || 0,
          cacheCreationTokens: responseData.usage.cache_creation_input_tokens || 0,
        };
      }
    } catch (parseErr) {
      // 無法解析 token 使用量，跳過
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

// ==================== 輔助函數 ====================

/**
 * 選擇延遲最低的 Base URL
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
 * 選擇可用的 Channel Key
 */
function selectChannelKey(channel: Channel): ChannelKey | null {
  const nowSec = Math.floor(Date.now() / 1000);
  let best: ChannelKey | null = null;

  for (const key of channel.keys) {
    if (!key.enabled || !key.channelKey) continue;

    // 429 冷卻期檢查（5 分鐘）
    if (key.statusCode === 429 && key.lastUseTimeStamp > 0) {
      if (nowSec - key.lastUseTimeStamp < 300) continue;
    }

    // 選擇成本最低的 Key
    if (!best || key.totalCost < best.totalCost) {
      best = key;
    }
  }

  return best;
}

/**
 * 複製請求頭
 */
function copyHeaders(
  inRequest: Request,
  outRequest: Request,
  customHeaders: Array<{ headerKey: string; headerValue: string }>
) {
  // Hop-by-hop headers 不應該轉發
  const hopByHopHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
  ]);

  for (const [key, value] of inRequest.headers) {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      outRequest.headers.set(key, value);
    }
  }

  // 自訂 Headers
  for (const header of customHeaders) {
    outRequest.headers.set(header.headerKey, header.headerValue);
  }
}

/**
 * 載入熔斷器設定（從 DB 讀取，帶預設值）
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
 * 記錄統計信息
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

  // 計算費用
  const costCalculation = await calculateCost(
    env.DB,
    env.CACHE,
    data.requestModelName,
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheCreationTokens
  );

  // 記錄到 StatsAggregator DO
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
    // 不阻斷請求
  }

  // 記錄到 Relay Log
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
    // 不阻斷請求
  }
}
