/**
 * Statistics 查詢 API
 */

import { Hono } from 'hono';
import type { Bindings, Variables } from '@/types';

const stats = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * GET /api/v1/admin/stats
 * 獲取整體統計
 */
stats.get('/', async (c) => {
  try {
    // 從 StatsAggregator DO 獲取統計
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
      return c.json({ code: 500, message: '獲取統計失敗' }, 500);
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
 * 獲取 Relay 日誌
 */
stats.get('/logs', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '100');
    const offset = parseInt(c.req.query('offset') || '0');
    const apiKeyId = c.req.query('api_key_id');
    const channelId = c.req.query('channel_id');
    const success = c.req.query('success');

    // 構建查詢
    let query = 'SELECT * FROM relay_logs WHERE 1=1';
    const bindings: any[] = [];

    if (apiKeyId) {
      query += ' AND api_key_id = ?';
      bindings.push(parseInt(apiKeyId));
    }

    if (channelId) {
      query += ' AND channel_id = ?';
      bindings.push(parseInt(channelId));
    }

    if (success !== undefined) {
      query += ' AND success = ?';
      bindings.push(success === 'true' ? 1 : 0);
    }

    query += ' ORDER BY time DESC LIMIT ? OFFSET ?';
    bindings.push(limit, offset);

    // 執行查詢
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
    return c.json({ code: 500, message: '獲取日誌失敗' }, 500);
  }
});

/**
 * GET /api/v1/admin/stats/models/:model
 * 獲取特定模型的統計
 */
stats.get('/models/:model', async (c) => {
  const model = c.req.param('model');

  try {
    // 從 relay_logs 聚合統計
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
    return c.json({ code: 500, message: '獲取模型統計失敗' }, 500);
  }
});

/**
 * GET /api/v1/admin/stats/date-range
 * 獲取日期範圍內的統計
 */
stats.get('/date-range', async (c) => {
  const startDate = c.req.query('start_date'); // Unix timestamp
  const endDate = c.req.query('end_date'); // Unix timestamp

  if (!startDate || !endDate) {
    return c.json(
      {
        code: 400,
        message: '需要提供 start_date 和 end_date 參數',
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
      .bind(parseInt(startDate), parseInt(endDate))
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
        startDate: parseInt(startDate),
        endDate: parseInt(endDate),
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

export default stats;
