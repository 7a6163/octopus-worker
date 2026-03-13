/**
 * StatsAggregator Durable Object
 * 對應原始 Go 專案的統計聚合功能
 *
 * 功能：
 * - 即時聚合統計數據（記憶體中）
 * - 定期持久化到 D1
 * - 支援多維度統計
 */

import { DurableObject } from 'cloudflare:workers';

interface StatsData {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  lastUpdated: number;
}

/**
 * StatsAggregator Durable Object
 */
export class StatsAggregator extends DurableObject {
  private stats: StatsData = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    lastUpdated: Date.now(),
  };

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
  }

  /**
   * 初始化
   */
  async initialize() {
    const stored = await this.ctx.storage.get<StatsData>('stats');
    if (stored) {
      this.stats = stored;
    }
  }

  /**
   * 記錄統計
   */
  async recordStats(data: {
    success: boolean;
    promptTokens: number;
    completionTokens: number;
    cost: number;
  }): Promise<void> {
    // 確保已初始化
    if (this.stats.totalRequests === 0 && this.stats.lastUpdated === 0) {
      await this.initialize();
    }

    // 更新統計
    this.stats.totalRequests++;
    if (data.success) {
      this.stats.successRequests++;
    } else {
      this.stats.failedRequests++;
    }
    this.stats.totalPromptTokens += data.promptTokens;
    this.stats.totalCompletionTokens += data.completionTokens;
    this.stats.totalCost += data.cost;
    this.stats.lastUpdated = Date.now();

    // 定期持久化（每 100 次請求）
    if (this.stats.totalRequests % 100 === 0) {
      await this.persist();
    }
  }

  /**
   * 獲取統計
   */
  async getStats(): Promise<StatsData> {
    if (this.stats.totalRequests === 0 && this.stats.lastUpdated === 0) {
      await this.initialize();
    }
    return { ...this.stats };
  }

  /**
   * 持久化統計
   */
  async persist(): Promise<void> {
    await this.ctx.storage.put('stats', this.stats);
  }

  /**
   * 重置統計
   */
  async reset(): Promise<void> {
    this.stats = {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      lastUpdated: Date.now(),
    };
    await this.persist();
  }

  /**
   * HTTP API 處理器
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // POST /record
      if (path === '/record' && request.method === 'POST') {
        const data = await request.json<{
          success: boolean;
          promptTokens: number;
          completionTokens: number;
          cost: number;
        }>();

        await this.recordStats(data);
        return Response.json({ success: true });
      }

      // GET /stats
      if (path === '/stats' && request.method === 'GET') {
        const stats = await this.getStats();
        return Response.json({ success: true, data: stats });
      }

      // POST /persist
      if (path === '/persist' && request.method === 'POST') {
        await this.persist();
        return Response.json({ success: true, message: 'Stats persisted' });
      }

      // POST /reset
      if (path === '/reset' && request.method === 'POST') {
        await this.reset();
        return Response.json({ success: true, message: 'Stats reset' });
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (err) {
      return Response.json(
        { error: (err as Error).message },
        { status: 500 }
      );
    }
  }
}
