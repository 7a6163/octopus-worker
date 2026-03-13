/**
 * Cron 定時任務處理器
 *
 * 任務：
 * - 每 10 分鐘：統計聚合
 * - 每小時：同步模型價格
 * - 每天：清理過期日誌
 */

import type { Bindings } from '@/types';
import { cleanupOldLogs } from '@/services/log/relay-log';

/**
 * 處理定時任務
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Bindings,
  _ctx: ExecutionContext
): Promise<void> {
  const cron = event.cron;
  console.log(`Cron triggered: ${cron}`);

  try {
    // 每 10 分鐘：觸發統計聚合持久化
    if (cron === '*/10 * * * *') {
      await persistStats(env);
    }

    // 每小時：同步模型價格
    if (cron === '0 * * * *') {
      await syncModelPricing(env);
    }

    // 每天：清理過期日誌
    if (cron === '0 0 * * *') {
      await cleanupLogs(env);
    }
  } catch (err) {
    console.error('Cron task failed:', err);
  }
}

/**
 * 持久化統計數據
 */
async function persistStats(env: Bindings): Promise<void> {
  try {
    // 觸發 StatsAggregator DO 持久化
    const doId = env.STATS_AGGREGATOR.idFromName('global');
    const doStub = env.STATS_AGGREGATOR.get(doId);

    const response = await doStub.fetch('https://internal/persist', {
      method: 'POST',
    });

    if (response.ok) {
      console.log('Stats persisted successfully');
    } else {
      console.error('Failed to persist stats:', await response.text());
    }
  } catch (err) {
    console.error('Failed to persist stats:', err);
  }
}

/**
 * 同步模型價格
 */
async function syncModelPricing(_env: Bindings): Promise<void> {
  try {
    // TODO: 從外部 API 獲取最新價格並更新到 llm_infos 表
    // 目前只記錄日誌
    console.log('Model pricing sync triggered (not implemented yet)');
  } catch (err) {
    console.error('Failed to sync model pricing:', err);
  }
}

/**
 * 清理過期日誌
 */
async function cleanupLogs(env: Bindings): Promise<void> {
  try {
    // 從 settings 讀取保留期限（預設 7 天）
    const keepDays = 7; // TODO: 從 settings 讀取

    const deletedCount = await cleanupOldLogs(env.DB, keepDays);
    console.log(`Cleaned up ${deletedCount} old logs`);
  } catch (err) {
    console.error('Failed to cleanup logs:', err);
  }
}
