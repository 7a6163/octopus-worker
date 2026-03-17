/**
 * Weighted load balancer
 * Corresponds to internal/balancer/weighted.go in the original Go project
 *
 * Features:
 * - Weight-proportional random selection
 * - Distributes requests based on weight
 * - Supports excluding failed items
 */

import type { Group, GroupItem } from '@/types/group';
import type { Balancer } from './interface';
import { filterAvailableItems } from './interface';

/**
 * Weighted load balancer
 * Uses weight-proportional random selection
 */
export class WeightedBalancer implements Balancer {
  /**
   * Select the next GroupItem using weight-proportional random selection
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

    return this.weightedRandomSelect(availableItems);
  }

  /**
   * Weight-proportional random selection
   *
   * Picks a random number in [0, totalWeight) and walks through items
   * accumulating weight until the random value is covered. Items with
   * higher weight are proportionally more likely to be selected.
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
   * Reset state (no-op for random selection)
   */
  async reset(_groupId: number): Promise<void> {
    // No persistent state to reset for weight-proportional random selection
  }
}
