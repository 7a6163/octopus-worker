/**
 * Cron 定時任務處理器
 *
 * 任務：
 * - 每 10 分鐘：統計聚合
 * - 每小時：同步模型價格
 * - 每天：清理過期日誌
 */

import { cleanupOldLogs } from '@/services/log/relay-log';
import { syncChannelModels } from '@/services/sync/channel-sync';
import { syncModelPricing } from '@/services/sync/price-sync';
import type { Bindings } from '@/types';

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

    // 每小時：同步模型價格 + 渠道模型同步
    if (cron === '0 * * * *') {
      await runHourlySync(env);
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
 * Hourly sync: model pricing + channel models
 */
async function runHourlySync(env: Bindings): Promise<void> {
  try {
    const count = await syncModelPricing(env);
    console.log(`Model pricing sync completed: ${count} models`);
  } catch (err) {
    console.error('Failed to sync model pricing:', err);
  }

  try {
    await syncChannelModels(env);
    console.log('Channel model sync completed');
  } catch (err) {
    console.error('Failed to sync channel models:', err);
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
