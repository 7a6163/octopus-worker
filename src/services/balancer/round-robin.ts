/**
 * RoundRobin 負載平衡器
 * 對應原始 Go 專案的 internal/balancer/roundrobin.go
 *
 * 功能：
 * - 使用 Durable Objects 維護分散式計數器
 * - 輪詢選擇 GroupItem
 * - 支援排除失敗的項目
 */

import type { Balancer } from './interface';
import type { Group, GroupItem } from '@/types/group';
import type { Bindings } from '@/types';
import { filterAvailableItems } from './interface';

/**
 * RoundRobin 負載平衡器
 */
export class RoundRobinBalancer implements Balancer {
  private env: Bindings;

  constructor(env: Bindings) {
    this.env = env;
  }

  /**
   * 選擇下一個 GroupItem（輪詢）
   */
  async selectNext(group: Group, excludeIds?: Set<number>): Promise<GroupItem | null> {
    // 過濾可用的項目
    const availableItems = filterAvailableItems(group.items, excludeIds);

    if (availableItems.length === 0) {
      return null;
    }

    // 如果只有一個項目，直接返回
    if (availableItems.length === 1) {
      return availableItems[0]!;
    }

    // 獲取 Durable Object 實例
    const doId = this.env.ROUND_ROBIN_COUNTER.idFromName(`group-${group.id}`);
    const doStub = this.env.ROUND_ROBIN_COUNTER.get(doId);

    try {
      // 調用 DO 獲取下一個索引
      const response = await doStub.fetch(
        `https://internal/next?groupId=${group.id}&itemCount=${availableItems.length}`
      );

      if (!response.ok) {
        throw new Error(`DO request failed: ${response.status}`);
      }

      const data = await response.json<{ nextIndex: number }>();
      const nextIndex = data.nextIndex;

      // 返回選中的項目
      return availableItems[nextIndex] || availableItems[0]!;
    } catch (err) {
      console.error('RoundRobinBalancer: Failed to get next index from DO:', err);
      // 降級：本地隨機選擇
      const randomIndex = Math.floor(Math.random() * availableItems.length);
      return availableItems[randomIndex]!;
    }
  }

  /**
   * 重置計數器
   */
  async reset(groupId: number): Promise<void> {
    try {
      const doId = this.env.ROUND_ROBIN_COUNTER.idFromName(`group-${groupId}`);
      const doStub = this.env.ROUND_ROBIN_COUNTER.get(doId);

      const response = await doStub.fetch(
        `https://internal/reset?groupId=${groupId}`,
        { method: 'POST' }
      );

      if (!response.ok) {
        throw new Error(`DO reset failed: ${response.status}`);
      }
    } catch (err) {
      console.error('RoundRobinBalancer: Failed to reset counter:', err);
    }
  }
}
