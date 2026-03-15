/**
 * RoundRobinCounter Durable Object
 * Corresponds to internal/balancer/roundrobin.go in the original Go project
 *
 * Features:
 * - Maintains an independent counter per Group
 * - Concurrency-safe counter increments
 * - Periodic counter state persistence (every 100 writes)
 * - Counter reset support
 */

import { DurableObject } from 'cloudflare:workers';

interface CounterState {
  [groupId: string]: number;
}

/**
 * RoundRobinCounter Durable Object
 * Implements distributed round-robin load balancing
 */
export class RoundRobinCounter extends DurableObject {
  private counters: CounterState = {};
  private writeCount = 0;
  private readonly PERSIST_INTERVAL = 100; // Persist every 100 writes

  /**
   * Initialize Durable Object
   * Load counter state from persistent storage
   */
  async initialize() {
    const stored = await this.ctx.storage.get<CounterState>('counters');
    if (stored) {
      this.counters = stored;
    }
  }

  /**
   * Get the next index (atomic operation)
   * @param groupId Group ID
   * @param itemCount Number of items in the Group
   * @returns The next index to use
   */
  async getNext(groupId: number, itemCount: number): Promise<number> {
    // Ensure initialized
    if (Object.keys(this.counters).length === 0 && this.writeCount === 0) {
      await this.initialize();
    }

    const key = groupId.toString();

    // Get current counter value
    const current = this.counters[key] || 0;

    // Calculate next index (cyclic)
    const nextIndex = current % itemCount;

    // Update counter
    this.counters[key] = current + 1;
    this.writeCount++;

    // Persist periodically
    if (this.writeCount >= this.PERSIST_INTERVAL) {
      await this.persistCounters();
      this.writeCount = 0;
    }

    return nextIndex;
  }

  /**
   * Reset counter for a specific Group
   * @param groupId Group ID
   */
  async reset(groupId: number): Promise<void> {
    const key = groupId.toString();
    this.counters[key] = 0;
    await this.persistCounters();
  }

  /**
   * Reset all counters
   */
  async resetAll(): Promise<void> {
    this.counters = {};
    await this.persistCounters();
  }

  /**
   * Get current counter value (for debugging)
   * @param groupId Group ID
   */
  async getCurrent(groupId: number): Promise<number> {
    const key = groupId.toString();
    return this.counters[key] || 0;
  }

  /**
   * Persist counter state
   */
  private async persistCounters(): Promise<void> {
    await this.ctx.storage.put('counters', this.counters);
  }

  /**
   * HTTP API handler
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
