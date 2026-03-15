/**
 * Weighted 負載平衡器
 * 對應原始 Go 專案的 internal/balancer/weighted.go
 *
 * 功能：
 * - 加權輪詢（Weighted Round Robin）
 * - 根據權重分配請求
 * - 支援排除失敗的項目
 */

import type { Bindings } from '@/types';
import type { Group, GroupItem } from '@/types/group';
import type { Balancer } from './interface';
import { filterAvailableItems } from './interface';

/**
 * Weighted 負載平衡器
 * 使用 Smooth Weighted Round Robin 演算法
 */
export class WeightedBalancer implements Balancer {
  private env: Bindings;

  constructor(env: Bindings) {
    this.env = env;
  }

  /**
   * 選擇下一個 GroupItem（加權輪詢）
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
    const doId = this.env.ROUND_ROBIN_COUNTER.idFromName(`group-${group.id}-weighted`);
    const doStub = this.env.ROUND_ROBIN_COUNTER.get(doId);

    try {
      // 獲取當前計數器
      const response = await doStub.fetch(`https://internal/current?groupId=${group.id}`);

      if (!response.ok) {
        throw new Error(`DO request failed: ${response.status}`);
      }

      const data = await response.json<{ current: number }>();
      const counter = data.current;

      // 使用 Smooth Weighted Round Robin 演算法
      const selected = this.smoothWeightedRoundRobin(availableItems, counter);

      // 更新計數器
      await doStub.fetch(`https://internal/next?groupId=${group.id}&itemCount=999999`);

      return selected;
    } catch (err) {
      console.error('WeightedBalancer: Failed to access DO:', err);
      // 降級：使用權重隨機
      return this.weightedRandomSelect(availableItems);
    }
  }

  /**
   * Smooth Weighted Round Robin 演算法
   *
   * 原理：
   * 1. 每個項目維護一個當前權重（currentWeight）
   * 2. 每次選擇時，所有項目的 currentWeight += weight
   * 3. 選擇 currentWeight 最大的項目
   * 4. 被選中項目的 currentWeight -= totalWeight
   *
   * 優點：分佈更均勻，避免連續選中高權重項目
   */
  private smoothWeightedRoundRobin(items: GroupItem[], counter: number): GroupItem {
    // 計算總權重
    const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0);

    // 為每個項目計算當前權重
    interface WeightedItem {
      item: GroupItem;
      currentWeight: number;
    }

    const weightedItems: WeightedItem[] = items.map((item) => {
      const weight = item.weight || 1;
      // 基於計數器計算當前權重
      const currentWeight = (weight * (counter + 1)) % (totalWeight + weight);
      return { item, currentWeight };
    });

    // 選擇當前權重最大的項目
    let maxItem = weightedItems[0]!;
    for (const weightedItem of weightedItems) {
      if (weightedItem.currentWeight > maxItem.currentWeight) {
        maxItem = weightedItem;
      }
    }

    return maxItem.item;
  }

  /**
   * 加權隨機選擇（降級策略）
   */
  private weightedRandomSelect(items: GroupItem[]): GroupItem {
    // 計算總權重
    const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0);

    // 生成隨機數
    let random = Math.random() * totalWeight;

    // 選擇項目
    for (const item of items) {
      const weight = item.weight || 1;
      random -= weight;
      if (random <= 0) {
        return item;
      }
    }

    // 降級返回第一個
    return items[0]!;
  }

  /**
   * 重置計數器
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
