/**
 * Cron scheduled task handler
 *
 * Tasks:
 * - Every 10 minutes: stats aggregation
 * - Every hour: sync model pricing
 * - Every day: clean up expired logs
 */

import { cleanupOldLogs } from '@/services/log/relay-log';
import { syncChannelModels } from '@/services/sync/channel-sync';
import { syncModelPricing } from '@/services/sync/price-sync';
import type { Bindings } from '@/types';

/**
 * Handle scheduled tasks
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Bindings,
  _ctx: ExecutionContext
): Promise<void> {
  const cron = event.cron;
  console.log(`Cron triggered: ${cron}`);

  try {
    // Every 10 minutes: trigger stats aggregation persistence
    if (cron === '*/10 * * * *') {
      await persistStats(env);
    }

    // Every hour: sync model pricing + channel model sync
    if (cron === '0 * * * *') {
      await runHourlySync(env);
    }

    // Every day: clean up expired logs
    if (cron === '0 0 * * *') {
      await cleanupLogs(env);
    }
  } catch (err) {
    console.error('Cron task failed:', err);
  }
}

/**
 * Persist stats data
 */
async function persistStats(env: Bindings): Promise<void> {
  try {
    // Trigger StatsAggregator DO persistence
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
 * Clean up expired logs
 */
async function cleanupLogs(env: Bindings): Promise<void> {
  try {
    // Read retention period from settings (default 7 days)
    const keepDays = 7; // TODO: read from settings

    const deletedCount = await cleanupOldLogs(env.DB, keepDays);
    console.log(`Cleaned up ${deletedCount} old logs`);
  } catch (err) {
    console.error('Failed to cleanup logs:', err);
  }
}
