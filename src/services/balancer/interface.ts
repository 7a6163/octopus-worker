/**
 * Load balancer interface
 * Corresponds to internal/balancer/interface.go in the original Go project
 */

import type { Bindings } from '@/types';
import type { Group, GroupItem } from '@/types/group';
import { GroupMode } from '@/types/group';

/**
 * Load balancer interface
 */
export interface Balancer {
  /**
   * Select the next GroupItem
   * @param group - Model group
   * @param excludeIds - GroupItem IDs to exclude (failed items)
   * @returns The selected GroupItem or null
   */
  selectNext(group: Group, excludeIds?: Set<number>): Promise<GroupItem | null>;

  /**
   * Reset load balancer state
   * @param groupId - Group ID
   */
  reset(groupId: number): Promise<void>;
}

import { FailoverBalancer } from './failover';
import { RandomBalancer } from './random';
// Import all load balancers
import { RoundRobinBalancer } from './round-robin';
import { WeightedBalancer } from './weighted';

/**
 * Load balancer factory
 * @param mode - Load balancing mode
 * @param env - Cloudflare Workers environment bindings
 * @returns The corresponding load balancer instance
 */
export function getBalancer(mode: GroupMode, env: Bindings): Balancer {
  switch (mode) {
    case GroupMode.RoundRobin:
      return new RoundRobinBalancer(env);
    case GroupMode.Random:
      return new RandomBalancer();
    case GroupMode.Failover:
      return new FailoverBalancer();
    case GroupMode.Weighted:
      return new WeightedBalancer();
    default:
      // Default to RoundRobin
      return new RoundRobinBalancer(env);
  }
}

/**
 * Helper: filter available GroupItems
 * @param items - All GroupItems
 * @param excludeIds - IDs to exclude
 * @returns Available GroupItems
 */
export function filterAvailableItems(items: GroupItem[], excludeIds?: Set<number>): GroupItem[] {
  if (!excludeIds || excludeIds.size === 0) {
    return items;
  }

  return items.filter((item) => !excludeIds.has(item.id));
}
