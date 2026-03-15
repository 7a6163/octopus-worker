/**
 * RoundRobinCounter Durable Object
 * 對應原始 Go 專案的 internal/balancer/roundrobin.go
 *
 * 功能：
 * - 為每個 Group 維護獨立的計數器
 * - 支援並發安全的計數器增加
 * - 定期持久化計數器狀態（每 100 次寫入一次）
 * - 支援計數器重置
 */

import { DurableObject } from 'cloudflare:workers';

interface CounterState {
  [groupId: string]: number;
}

/**
 * RoundRobinCounter Durable Object
 * 用於實作分散式 RoundRobin 負載平衡
 */
export class RoundRobinCounter extends DurableObject {
  private counters: CounterState = {};
  private writeCount = 0;
  private readonly PERSIST_INTERVAL = 100; // 每 100 次寫入持久化一次

  /**
   * 初始化 Durable Object
   * 從持久化存儲載入計數器狀態
   */
  async initialize() {
    const stored = await this.ctx.storage.get<CounterState>('counters');
    if (stored) {
      this.counters = stored;
    }
  }

  /**
   * 獲取下一個索引（原子操作）
   * @param groupId Group ID
   * @param itemCount Group 中的 Item 數量
   * @returns 下一個應該使用的索引
   */
  async getNext(groupId: number, itemCount: number): Promise<number> {
    // 確保已初始化
    if (Object.keys(this.counters).length === 0 && this.writeCount === 0) {
      await this.initialize();
    }

    const key = groupId.toString();

    // 獲取當前計數器值
    const current = this.counters[key] || 0;

    // 計算下一個索引（循環）
    const nextIndex = current % itemCount;

    // 更新計數器
    this.counters[key] = current + 1;
    this.writeCount++;

    // 定期持久化
    if (this.writeCount >= this.PERSIST_INTERVAL) {
      await this.persistCounters();
      this.writeCount = 0;
    }

    return nextIndex;
  }

  /**
   * 重置指定 Group 的計數器
   * @param groupId Group ID
   */
  async reset(groupId: number): Promise<void> {
    const key = groupId.toString();
    this.counters[key] = 0;
    await this.persistCounters();
  }

  /**
   * 重置所有計數器
   */
  async resetAll(): Promise<void> {
    this.counters = {};
    await this.persistCounters();
  }

  /**
   * 獲取當前計數器值（用於調試）
   * @param groupId Group ID
   */
  async getCurrent(groupId: number): Promise<number> {
    const key = groupId.toString();
    return this.counters[key] || 0;
  }

  /**
   * 持久化計數器狀態
   */
  private async persistCounters(): Promise<void> {
    await this.ctx.storage.put('counters', this.counters);
  }

  /**
   * HTTP API 處理器
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // GET /next?groupId=1&itemCount=3
      if (path === '/next' && request.method === 'GET') {
        const groupId = parseInt(url.searchParams.get('groupId') || '0', 10);
        const itemCount = parseInt(url.searchParams.get('itemCount') || '1', 10);

        if (!groupId || !itemCount) {
          return Response.json({ error: 'groupId and itemCount are required' }, { status: 400 });
        }

        const nextIndex = await this.getNext(groupId, itemCount);
        return Response.json({ groupId, itemCount, nextIndex });
      }

      // POST /reset?groupId=1
      if (path === '/reset' && request.method === 'POST') {
        const groupId = parseInt(url.searchParams.get('groupId') || '0', 10);

        if (!groupId) {
          return Response.json({ error: 'groupId is required' }, { status: 400 });
        }

        await this.reset(groupId);
        return Response.json({ success: true, groupId });
      }

      // POST /reset-all
      if (path === '/reset-all' && request.method === 'POST') {
        await this.resetAll();
        return Response.json({ success: true });
      }

      // GET /current?groupId=1
      if (path === '/current' && request.method === 'GET') {
        const groupId = parseInt(url.searchParams.get('groupId') || '0', 10);

        if (!groupId) {
          return Response.json({ error: 'groupId is required' }, { status: 400 });
        }

        const current = await this.getCurrent(groupId);
        return Response.json({ groupId, current });
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }
}
