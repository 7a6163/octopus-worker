/**
 * Failover load balancer
 * Corresponds to internal/balancer/failover.go in the original Go project
 *
 * Features:
 * - Selects GroupItem by priority order
 * - Supports failover (lower-priority items serve as backups)
 * - Supports excluding failed items
 */

import type { Group, GroupItem } from '@/types/group';
import type { Balancer } from './interface';
import { filterAvailableItems } from './interface';

/**
 * Failover load balancer
 */
export class FailoverBalancer implements Balancer {
  /**
   * Select the next GroupItem (by priority)
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

    // Sort by priority (lower value = higher priority)
    const sortedItems = [...availableItems].sort((a, b) => {
      // Sort by priority first
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Break ties by id
      return a.id - b.id;
    });

    // Return the highest-priority item
    return sortedItems[0]!;
  }

  /**
   * Reset (failover mode has no state)
   */
  async reset(_groupId: number): Promise<void> {
    // Failover mode is stateless, no reset needed
  }
}
