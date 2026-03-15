/**
 * Weighted load balancer
 * Corresponds to internal/balancer/weighted.go in the original Go project
 *
 * Features:
 * - Weighted Round Robin
 * - Distributes requests based on weight
 * - Supports excluding failed items
 */

import type { Bindings } from '@/types';
import type { Group, GroupItem } from '@/types/group';
import type { Balancer } from './interface';
import { filterAvailableItems } from './interface';

/**
 * Weighted load balancer
 * Uses Smooth Weighted Round Robin algorithm
 */
export class WeightedBalancer implements Balancer {
  private env: Bindings;

  constructor(env: Bindings) {
    this.env = env;
  }

  /**
   * Select the next GroupItem (weighted round robin)
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
    const doId = this.env.ROUND_ROBIN_COUNTER.idFromName(`group-${group.id}-weighted`);
    const doStub = this.env.ROUND_ROBIN_COUNTER.get(doId);

    try {
      // Get current counter
      const response = await doStub.fetch(`https://internal/current?groupId=${group.id}`);

      if (!response.ok) {
        throw new Error(`DO request failed: ${response.status}`);
      }

      const data = await response.json<{ current: number }>();
      const counter = data.current;

      // Use Smooth Weighted Round Robin algorithm
      const selected = this.smoothWeightedRoundRobin(availableItems, counter);

      // Increment counter
      await doStub.fetch(`https://internal/next?groupId=${group.id}&itemCount=999999`);

      return selected;
    } catch (err) {
      console.error('WeightedBalancer: Failed to access DO:', err);
      // Fallback: use weighted random selection
      return this.weightedRandomSelect(availableItems);
    }
  }

  /**
   * Smooth Weighted Round Robin algorithm
   *
   * How it works:
   * 1. Each item maintains a current weight (currentWeight)
   * 2. On each selection, all items' currentWeight += weight
   * 3. Select the item with the highest currentWeight
   * 4. Subtract totalWeight from the selected item's currentWeight
   *
   * Advantage: More even distribution, avoids consecutively selecting high-weight items
   */
  private smoothWeightedRoundRobin(items: GroupItem[], counter: number): GroupItem {
    // Calculate total weight
    const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0);

    // Calculate current weight for each item
    interface WeightedItem {
      item: GroupItem;
      currentWeight: number;
    }

    const weightedItems: WeightedItem[] = items.map((item) => {
      const weight = item.weight || 1;
      // Calculate current weight based on counter
      const currentWeight = (weight * (counter + 1)) % (totalWeight + weight);
      return { item, currentWeight };
    });

    // Select the item with the highest current weight
    let maxItem = weightedItems[0]!;
    for (const weightedItem of weightedItems) {
      if (weightedItem.currentWeight > maxItem.currentWeight) {
        maxItem = weightedItem;
      }
    }

    return maxItem.item;
  }

  /**
   * Weighted random selection (fallback strategy)
   */
  private weightedRandomSelect(items: GroupItem[]): GroupItem {
    // Calculate total weight
    const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0);

    // Generate random number
    let random = Math.random() * totalWeight;

    // Select item
    for (const item of items) {
      const weight = item.weight || 1;
      random -= weight;
      if (random <= 0) {
        return item;
      }
    }

    // Fallback: return the first item
    return items[0]!;
  }

  /**
   * Reset counter
   */
  async reset(groupId: number): Promise<void> {
    try {
      const doId = this.env.ROUND_ROBIN_COUNTER.idFromName(`group-${groupId}-weighted`);
      const doStub = this.env.ROUND_ROBIN_COUNTER.get(doId);

      const response = await doStub.fetch(`https://internal/reset?groupId=${groupId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`DO reset failed: ${response.status}`);
      }
    } catch (err) {
      console.error('WeightedBalancer: Failed to reset counter:', err);
    }
  }
}
