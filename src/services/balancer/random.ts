/**
 * Random 負載平衡器
 * 對應原始 Go 專案的 internal/balancer/random.go
 *
 * 功能：
 * - 隨機選擇 GroupItem
 * - 支援加權隨機（基於 weight）
 * - 支援排除失敗的項目
 */

import type { Balancer } from './interface';
import type { Group, GroupItem } from '@/types/group';
import type { Bindings } from '@/types';
import { filterAvailableItems } from './interface';

/**
 * Random 負載平衡器
 */
export class RandomBalancer implements Balancer {
  constructor(_env: Bindings) {
    // Random 模式不需要環境變數
  }

  /**
   * 選擇下一個 GroupItem（隨機）
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

    // 檢查是否有權重
    const hasWeight = availableItems.some((item) => item.weight > 0);

    if (hasWeight) {
      // 加權隨機
      return this.weightedRandomSelect(availableItems);
    } else {
      // 均勻隨機
      const randomIndex = Math.floor(Math.random() * availableItems.length);
      return availableItems[randomIndex]!;
    }
  }

  /**
   * 加權隨機選擇
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
   * 重置（Random 模式不需要狀態）
   */
  async reset(_groupId: number): Promise<void> {
    // Random 模式無狀態，無需重置
  }
}
