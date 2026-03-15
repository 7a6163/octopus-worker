/**
 * StatsAggregator Durable Object
 * Corresponds to the stats aggregation feature in the original Go project
 *
 * Features:
 * - Real-time stats aggregation (in-memory)
 * - Periodic persistence to D1
 * - Multi-dimensional statistics
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

  /**
   * Initialize
   */
  async initialize() {
    const stored = await this.ctx.storage.get<StatsData>('stats');
    if (stored) {
      this.stats = stored;
    }
  }

  /**
   * Record stats
   */
  async recordStats(data: {
    success: boolean;
    promptTokens: number;
    completionTokens: number;
    cost: number;
  }): Promise<void> {
    // Ensure initialized
    if (this.stats.totalRequests === 0 && this.stats.lastUpdated === 0) {
      await this.initialize();
    }

    // Update stats
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

    // Persist periodically (every 100 requests)
    if (this.stats.totalRequests % 100 === 0) {
      await this.persist();
    }
  }

  /**
   * Get stats
   */
  async getStats(): Promise<StatsData> {
    if (this.stats.totalRequests === 0 && this.stats.lastUpdated === 0) {
      await this.initialize();
    }
    return { ...this.stats };
  }

  /**
   * Persist stats
   */
  async persist(): Promise<void> {
    await this.ctx.storage.put('stats', this.stats);
  }

  /**
   * Reset stats
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
   * HTTP API handler
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
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }
}
