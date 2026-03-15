/**
 * Statistics query API
 */

import { Hono } from 'hono';
import { syncModelPricing } from '@/services/sync/price-sync';
import type { Bindings, Variables } from '@/types';

const stats = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * GET /api/v1/admin/stats
 * Get overall statistics
 */
stats.get('/', async (c) => {
  try {
    // Get stats from StatsAggregator DO
    const doId = c.env.STATS_AGGREGATOR.idFromName('global');
    const doStub = c.env.STATS_AGGREGATOR.get(doId);

    const response = await doStub.fetch('https://internal/stats');
    const result = await response.json<{
      success: boolean;
      data: {
        totalRequests: number;
        successRequests: number;
        failedRequests: number;
        totalPromptTokens: number;
        totalCompletionTokens: number;
        totalCost: number;
        lastUpdated: number;
      };
    }>();

    if (!result.success) {
      return c.json({ code: 500, message: 'Failed to get statistics' }, 500);
    }

    return c.json({
      code: 200,
      data: result.data,
    });
  } catch (err) {
    console.error('Failed to get stats:', err);
    return c.json({ code: 500, message: '獲取統計失敗' }, 500);
  }
});

/**
 * GET /api/v1/admin/logs
 * Get relay logs
 */
stats.get('/logs', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '100', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const apiKeyId = c.req.query('api_key_id');
    const channelId = c.req.query('channel_id');
    const success = c.req.query('success');

    // Build query
    let query = 'SELECT * FROM relay_logs WHERE 1=1';
    const bindings: any[] = [];

    if (apiKeyId) {
      query += ' AND api_key_id = ?';
      bindings.push(parseInt(apiKeyId, 10));
    }

    if (channelId) {
      query += ' AND channel_id = ?';
      bindings.push(parseInt(channelId, 10));
    }

    if (success !== undefined) {
      query += ' AND success = ?';
      bindings.push(success === 'true' ? 1 : 0);
    }

    query += ' ORDER BY time DESC LIMIT ? OFFSET ?';
    bindings.push(limit, offset);

    // Execute query
    const result = await c.env.DB.prepare(query)
      .bind(...bindings)
      .all();

    return c.json({
      code: 200,
      data: {
        logs: result.results || [],
        limit,
        offset,
        total: result.results?.length || 0,
      },
    });
  } catch (err) {
    console.error('Failed to get logs:', err);
    return c.json({ code: 500, message: 'Failed to get logs' }, 500);
  }
});

/**
 * GET /api/v1/admin/stats/models/:model
 * Get statistics for a specific model
 */
stats.get('/models/:model', async (c) => {
  const model = c.req.param('model');

  try {
    // Aggregate stats from relay_logs
    const result = await c.env.DB.prepare(
      `SELECT 
        COUNT(*) as total_requests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_requests,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_requests,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        SUM(total_cost) as total_cost,
        AVG(wait_time) as avg_wait_time
      FROM relay_logs
      WHERE request_model_name = ?`
    )
      .bind(model)
      .first<{
        total_requests: number;
        success_requests: number;
        failed_requests: number;
        total_prompt_tokens: number;
        total_completion_tokens: number;
        total_cost: number;
        avg_wait_time: number;
      }>();

    if (!result) {
      return c.json({
        code: 200,
        data: {
          model,
          totalRequests: 0,
          successRequests: 0,
          failedRequests: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalCost: 0,
          avgWaitTime: 0,
        },
      });
    }

    return c.json({
      code: 200,
      data: {
        model,
        totalRequests: result.total_requests,
        successRequests: result.success_requests,
        failedRequests: result.failed_requests,
        totalPromptTokens: result.total_prompt_tokens,
        totalCompletionTokens: result.total_completion_tokens,
        totalCost: result.total_cost,
        avgWaitTime: Math.round(result.avg_wait_time || 0),
      },
    });
  } catch (err) {
    console.error('Failed to get model stats:', err);
    return c.json({ code: 500, message: 'Failed to get model statistics' }, 500);
  }
});

/**
 * GET /api/v1/admin/stats/date-range
 * Get statistics within a date range
 */
stats.get('/date-range', async (c) => {
  const startDate = c.req.query('start_date'); // Unix timestamp
  const endDate = c.req.query('end_date'); // Unix timestamp

  if (!startDate || !endDate) {
    return c.json(
      {
        code: 400,
        message: 'start_date and end_date parameters are required',
      },
      400
    );
  }

  try {
    const result = await c.env.DB.prepare(
      `SELECT 
        COUNT(*) as total_requests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_requests,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_requests,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        SUM(total_cost) as total_cost,
        AVG(wait_time) as avg_wait_time
      FROM relay_logs
      WHERE time >= ? AND time <= ?`
    )
      .bind(parseInt(startDate, 10), parseInt(endDate, 10))
      .first<{
        total_requests: number;
        success_requests: number;
        failed_requests: number;
        total_prompt_tokens: number;
        total_completion_tokens: number;
        total_cost: number;
        avg_wait_time: number;
      }>();

    if (!result) {
      return c.json({
        code: 200,
        data: {
          totalRequests: 0,
          successRequests: 0,
          failedRequests: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalCost: 0,
          avgWaitTime: 0,
        },
      });
    }

    return c.json({
      code: 200,
      data: {
        startDate: parseInt(startDate, 10),
        endDate: parseInt(endDate, 10),
        totalRequests: result.total_requests,
        successRequests: result.success_requests,
        failedRequests: result.failed_requests,
        totalPromptTokens: result.total_prompt_tokens,
        totalCompletionTokens: result.total_completion_tokens,
        totalCost: result.total_cost,
        avgWaitTime: Math.round(result.avg_wait_time || 0),
      },
    });
  } catch (err) {
    console.error('Failed to get date range stats:', err);
    return c.json({ code: 500, message: '獲取統計失敗' }, 500);
  }
});

/**
 * GET /api/v1/admin/stats/today
 * Get today's statistics
 */
stats.get('/today', async (c) => {
  try {
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

    const result = await c.env.DB.prepare(
      `SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN error IS NULL OR error = '' THEN 1 ELSE 0 END) as success_requests,
        SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) as failed_requests,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cost) as total_cost,
        AVG(use_time) as avg_use_time
      FROM relay_logs
      WHERE time >= ?`
    )
      .bind(todayStart)
      .first<{
        total_requests: number;
        success_requests: number;
        failed_requests: number;
        total_input_tokens: number;
        total_output_tokens: number;
        total_cost: number;
        avg_use_time: number;
      }>();

    return c.json({
      code: 200,
      data: {
        todayStart,
        totalRequests: result?.total_requests ?? 0,
        successRequests: result?.success_requests ?? 0,
        failedRequests: result?.failed_requests ?? 0,
        totalInputTokens: result?.total_input_tokens ?? 0,
        totalOutputTokens: result?.total_output_tokens ?? 0,
        totalCost: result?.total_cost ?? 0,
        avgUseTime: Math.round(result?.avg_use_time ?? 0),
      },
    });
  } catch (err) {
    console.error('Failed to get today stats:', err);
    return c.json({ code: 500, message: 'Failed to get today stats' }, 500);
  }
});

/**
 * GET /api/v1/admin/stats/hourly
 * Get today's hourly statistics
 */
stats.get('/hourly', async (c) => {
  try {
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

    const result = await c.env.DB.prepare(
      `SELECT
        CAST((time - ?) / 3600 AS INTEGER) as hour,
        COUNT(*) as total_requests,
        SUM(CASE WHEN error IS NULL OR error = '' THEN 1 ELSE 0 END) as success_requests,
        SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) as failed_requests,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cost) as total_cost
      FROM relay_logs
      WHERE time >= ?
      GROUP BY hour
      ORDER BY hour ASC`
    )
      .bind(todayStart, todayStart)
      .all<{
        hour: number;
        total_requests: number;
        success_requests: number;
        failed_requests: number;
        total_input_tokens: number;
        total_output_tokens: number;
        total_cost: number;
      }>();

    // Build 24 hourly slots, filling missing hours with zeros
    const hourlyMap = new Map((result.results ?? []).map((r) => [r.hour, r]));

    const hourly = Array.from({ length: 24 }, (_, i) => {
      const row = hourlyMap.get(i);
      return {
        hour: i,
        totalRequests: row?.total_requests ?? 0,
        successRequests: row?.success_requests ?? 0,
        failedRequests: row?.failed_requests ?? 0,
        totalInputTokens: row?.total_input_tokens ?? 0,
        totalOutputTokens: row?.total_output_tokens ?? 0,
        totalCost: row?.total_cost ?? 0,
      };
    });

    return c.json({ code: 200, data: hourly });
  } catch (err) {
    console.error('Failed to get hourly stats:', err);
    return c.json({ code: 500, message: 'Failed to get hourly stats' }, 500);
  }
});

/**
 * GET /api/v1/admin/stats/channels
 * Get per-channel statistics
 */
stats.get('/channels', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      `SELECT
        channel_id,
        channel_name,
        COUNT(*) as total_requests,
        SUM(CASE WHEN error IS NULL OR error = '' THEN 1 ELSE 0 END) as success_requests,
        SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) as failed_requests,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cost) as total_cost,
        AVG(use_time) as avg_use_time
      FROM relay_logs
      WHERE channel_id IS NOT NULL
      GROUP BY channel_id
      ORDER BY total_requests DESC`
    ).all<{
      channel_id: number;
      channel_name: string;
      total_requests: number;
      success_requests: number;
      failed_requests: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost: number;
      avg_use_time: number;
    }>();

    const channels = (result.results ?? []).map((row) => ({
      channelId: row.channel_id,
      channelName: row.channel_name,
      totalRequests: row.total_requests,
      successRequests: row.success_requests,
      failedRequests: row.failed_requests,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalCost: row.total_cost,
      avgUseTime: Math.round(row.avg_use_time ?? 0),
    }));

    return c.json({ code: 200, data: channels });
  } catch (err) {
    console.error('Failed to get channel stats:', err);
    return c.json({ code: 500, message: 'Failed to get channel stats' }, 500);
  }
});

/**
 * GET /api/v1/admin/stats/apikeys
 * Get per-API-key statistics (from stats_api_key table)
 */
stats.get('/apikeys', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      `SELECT
        sa.api_key_id,
        ak.name as api_key_name,
        sa.input_token,
        sa.output_token,
        sa.input_cost,
        sa.output_cost,
        sa.wait_time,
        sa.request_success,
        sa.request_failed
      FROM stats_api_key sa
      LEFT JOIN api_keys ak ON ak.id = sa.api_key_id
      ORDER BY sa.request_success + sa.request_failed DESC`
    ).all<{
      api_key_id: number;
      api_key_name: string | null;
      input_token: number;
      output_token: number;
      input_cost: number;
      output_cost: number;
      wait_time: number;
      request_success: number;
      request_failed: number;
    }>();

    const apikeys = (result.results ?? []).map((row) => ({
      apiKeyId: row.api_key_id,
      apiKeyName: row.api_key_name,
      inputToken: row.input_token,
      outputToken: row.output_token,
      inputCost: row.input_cost,
      outputCost: row.output_cost,
      waitTime: row.wait_time,
      requestSuccess: row.request_success,
      requestFailed: row.request_failed,
    }));

    return c.json({ code: 200, data: apikeys });
  } catch (err) {
    console.error('Failed to get API key stats:', err);
    return c.json({ code: 500, message: 'Failed to get API key stats' }, 500);
  }
});

/**
 * POST /api/v1/admin/stats/price-sync
 * Manually trigger price sync
 */
stats.post('/price-sync', async (c) => {
  try {
    const count = await syncModelPricing(c.env);
    return c.json({
      code: 200,
      message: `Price sync completed, ${count} models updated`,
    });
  } catch (err) {
    console.error('Failed to sync model pricing:', err);
    return c.json({ code: 500, message: 'Failed to sync model pricing' }, 500);
  }
});

/**
 * GET /api/v1/admin/stats/model-list
 * Get all model pricing list
 */
stats.get('/model-list', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      `SELECT name, input, output, cache_read, cache_write
       FROM llm_infos
       ORDER BY name ASC`
    ).all<{
      name: string;
      input: number;
      output: number;
      cache_read: number;
      cache_write: number;
    }>();

    const models = (result.results ?? []).map((row) => ({
      name: row.name,
      input: row.input,
      output: row.output,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
    }));

    return c.json({ code: 200, data: models });
  } catch (err) {
    console.error('Failed to get model list:', err);
    return c.json({ code: 500, message: 'Failed to get model list' }, 500);
  }
});

export default stats;
