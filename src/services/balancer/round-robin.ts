/**
 * RoundRobin load balancer
 * Corresponds to internal/balancer/roundrobin.go in the original Go project
 *
 * Features:
 * - Uses Durable Objects to maintain a distributed counter
 * - Round-robin selection of GroupItems
 * - Supports excluding failed items
 */

import type { Bindings } from '@/types';
import type { Group, GroupItem } from '@/types/group';
import type { Balancer } from './interface';
import { filterAvailableItems } from './interface';

/**
 * RoundRobin load balancer
 */
export class RoundRobinBalancer implements Balancer {
  private env: Bindings;

  constructor(env: Bindings) {
    this.env = env;
  }

  /**
   * Select the next GroupItem (round robin)
   */
  async selectNext(group: Group, excludeIds?: Set<number>): Promise<GroupItem | null> {
    // Filter available items
    const availableItems = filterAvailableItems(group.items, excludeIds);

    if (availableItems.length === 0) {
      return null;
    }

    // If only one item, return it directly
    if (availableItems.length === 1) {
      return availableItems[0]!;
    }

    // Get Durable Object instance
    const doId = this.env.ROUND_ROBIN_COUNTER.idFromName(`group-${group.id}`);
    const doStub = this.env.ROUND_ROBIN_COUNTER.get(doId);

    try {
      // Call DO to get the next index
      const response = await doStub.fetch(
        `https://internal/next?groupId=${group.id}&itemCount=${availableItems.length}`
      );

      if (!response.ok) {
        throw new Error(`DO request failed: ${response.status}`);
      }

      const data = await response.json<{ nextIndex: number }>();
      const nextIndex = data.nextIndex;

      // Return the selected item
      return availableItems[nextIndex] || availableItems[0]!;
    } catch (err) {
      console.error('RoundRobinBalancer: Failed to get next index from DO:', err);
      // Fallback: local random selection
      const randomIndex = Math.floor(Math.random() * availableItems.length);
      return availableItems[randomIndex]!;
    }
  }

  /**
   * Reset counter
   */
  async reset(groupId: number): Promise<void> {
    try {
      const doId = this.env.ROUND_ROBIN_COUNTER.idFromName(`group-${groupId}`);
      const doStub = this.env.ROUND_ROBIN_COUNTER.get(doId);

      const response = await doStub.fetch(`https://internal/reset?groupId=${groupId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`DO reset failed: ${response.status}`);
      }
    } catch (err) {
      console.error('RoundRobinBalancer: Failed to reset counter:', err);
    }
  }
}
