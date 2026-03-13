/**
 * RelayLog 記錄服務
 * 對應原始 Go 專案的 internal/service/relay_log.go
 *
 * 功能：
 * - 記錄請求日誌到 D1
 * - 記錄 Token 使用量、費用、時間
 * - 支援批次寫入
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { InternalLLMResponse } from '@/types/llm';

/**
 * RelayLog 介面
 */
export interface RelayLogEntry {
  time: number;                    // Unix timestamp (秒)
  requestModelName: string;        // 請求的模型名稱
  channelId: number;               // 使用的渠道 ID
  channelName: string;             // 渠道名稱
  channelKeyId: number;            // 使用的 Key ID
  apiKeyId: number;                // 請求的 API Key ID
  promptTokens: number;            // Prompt Token 數量
  completionTokens: number;        // Completion Token 數量
  cacheReadTokens: number;         // Cache Read Token 數量
  cacheCreationTokens: number;     // Cache Creation Token 數量
  inputCost: number;               // Input 費用
  outputCost: number;              // Output 費用
  cacheReadCost: number;           // Cache Read 費用
  cacheCreationCost: number;       // Cache Creation 費用
  totalCost: number;               // 總費用
  waitTime: number;                // 等待時間（毫秒）
  success: boolean;                // 是否成功
  errorMessage: string;            // 錯誤訊息
}

/**
 * 創建 RelayLog
 */
export async function createRelayLog(
  db: D1Database,
  log: RelayLogEntry
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO relay_logs (
          time, request_model_name, channel_id, channel_name, channel_key_id,
          api_key_id, prompt_tokens, completion_tokens, cache_read_tokens,
          cache_creation_tokens, input_cost, output_cost, cache_read_cost,
          cache_creation_cost, total_cost, wait_time, success, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        log.time,
        log.requestModelName,
        log.channelId,
        log.channelName,
        log.channelKeyId,
        log.apiKeyId,
        log.promptTokens,
        log.completionTokens,
        log.cacheReadTokens,
        log.cacheCreationTokens,
        log.inputCost,
        log.outputCost,
        log.cacheReadCost,
        log.cacheCreationCost,
        log.totalCost,
        log.waitTime,
        log.success ? 1 : 0,
        log.errorMessage
      )
      .run();
  } catch (err) {
    console.error('Failed to create relay log:', err);
    // 不拋出錯誤，避免影響主流程
  }
}

/**
 * 批次創建 RelayLogs
 */
export async function batchCreateRelayLogs(
  db: D1Database,
  logs: RelayLogEntry[]
): Promise<void> {
  if (logs.length === 0) {
    return;
  }

  try {
    const statements = logs.map((log) =>
      db
        .prepare(
          `INSERT INTO relay_logs (
            time, request_model_name, channel_id, channel_name, channel_key_id,
            api_key_id, prompt_tokens, completion_tokens, cache_read_tokens,
            cache_creation_tokens, input_cost, output_cost, cache_read_cost,
            cache_creation_cost, total_cost, wait_time, success, error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          log.time,
          log.requestModelName,
          log.channelId,
          log.channelName,
          log.channelKeyId,
          log.apiKeyId,
          log.promptTokens,
          log.completionTokens,
          log.cacheReadTokens,
          log.cacheCreationTokens,
          log.inputCost,
          log.outputCost,
          log.cacheReadCost,
          log.cacheCreationCost,
          log.totalCost,
          log.waitTime,
          log.success ? 1 : 0,
          log.errorMessage
        )
    );

    await db.batch(statements);
  } catch (err) {
    console.error('Failed to batch create relay logs:', err);
  }
}

/**
 * 從 InternalLLMResponse 提取 Token 使用量
 */
export function extractTokenUsage(response: InternalLLMResponse | null): {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
} {
  if (!response || !response.usage) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
  }

  return {
    promptTokens: response.usage.promptTokens || 0,
    completionTokens: response.usage.completionTokens || 0,
    cacheReadTokens: response.usage.cacheReadInputTokens || 0,
    cacheCreationTokens: response.usage.cacheCreationInputTokens || 0,
  };
}

/**
 * 清理過期日誌
 * @param db D1 Database
 * @param keepDays 保留天數
 */
export async function cleanupOldLogs(db: D1Database, keepDays: number): Promise<number> {
  const cutoffTime = Math.floor(Date.now() / 1000) - keepDays * 86400;

  try {
    const result = await db
      .prepare(`DELETE FROM relay_logs WHERE time < ?`)
      .bind(cutoffTime)
      .run();

    const deletedCount = result.meta.changes || 0;
    console.log(`Cleaned up ${deletedCount} old relay logs (older than ${keepDays} days)`);
    return deletedCount;
  } catch (err) {
    console.error('Failed to cleanup old logs:', err);
    return 0;
  }
}
