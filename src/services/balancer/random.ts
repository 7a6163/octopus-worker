/**
 * Random load balancer
 * Corresponds to internal/balancer/random.go in the original Go project
 *
 * Features:
 * - Randomly selects a GroupItem
 * - Supports weighted random selection (based on weight)
 * - Supports excluding failed items
 */

import type { Group, GroupItem } from '@/types/group';
import type { Balancer } from './interface';
import { filterAvailableItems } from './interface';

/**
 * Random load balancer
 */
export class RandomBalancer implements Balancer {
  /**
   * Select the next GroupItem (random)
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

    // Check if items have weights
    const hasWeight = availableItems.some((item) => item.weight > 0);

    if (hasWeight) {
      // Weighted random
      return this.weightedRandomSelect(availableItems);
    } else {
      // Uniform random
      const randomIndex = Math.floor(Math.random() * availableItems.length);
      return availableItems[randomIndex]!;
    }
  }

  /**
   * Weighted random selection
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
   * Reset (random mode has no state)
   */
  async reset(_groupId: number): Promise<void> {
    // Random mode is stateless, no reset needed
  }
}
