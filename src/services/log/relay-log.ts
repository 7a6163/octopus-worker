/**
 * RelayLog recording service
 * Corresponds to internal/service/relay_log.go in the original Go project
 *
 * Features:
 * - Record request logs to D1
 * - Track token usage, cost, and timing
 * - Batch write support
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { InternalLLMResponse } from '@/types/llm';

/**
 * RelayLog interface
 */
export interface RelayLogEntry {
  time: number; // Unix timestamp (seconds)
  requestModelName: string; // Requested model name
  channelId: number; // Channel ID used
  channelName: string; // Channel name
  channelKeyId: number; // Key ID used
  apiKeyId: number; // API Key ID of the request
  promptTokens: number; // Prompt token count
  completionTokens: number; // Completion token count
  cacheReadTokens: number; // Cache read token count
  cacheCreationTokens: number; // Cache creation token count
  inputCost: number; // Input cost
  outputCost: number; // Output cost
  cacheReadCost: number; // Cache read cost
  cacheCreationCost: number; // Cache creation cost
  totalCost: number; // Total cost
  waitTime: number; // Wait time (milliseconds)
  success: boolean; // Whether successful
  errorMessage: string; // Error message
}

/**
 * Create a RelayLog entry
 */
export async function createRelayLog(db: D1Database, log: RelayLogEntry): Promise<void> {
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
    // Don't throw to avoid disrupting the main flow
  }
}

/**
 * Batch create RelayLog entries
 */
export async function batchCreateRelayLogs(db: D1Database, logs: RelayLogEntry[]): Promise<void> {
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
 * Extract token usage from InternalLLMResponse
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
 * Clean up expired logs
 * @param db D1 Database
 * @param keepDays Number of days to retain
 */
export async function cleanupOldLogs(db: D1Database, keepDays: number): Promise<number> {
  const cutoffTime = Math.floor(Date.now() / 1000) - keepDays * 86400;

  try {
    const result = await db.prepare(`DELETE FROM relay_logs WHERE time < ?`).bind(cutoffTime).run();

    const deletedCount = result.meta.changes || 0;
    console.log(`Cleaned up ${deletedCount} old relay logs (older than ${keepDays} days)`);
    return deletedCount;
  } catch (err) {
    console.error('Failed to cleanup old logs:', err);
    return 0;
  }
}
