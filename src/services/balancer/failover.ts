/**
 * Failover 負載平衡器
 * 對應原始 Go 專案的 internal/balancer/failover.go
 *
 * 功能：
 * - 按優先級排序選擇 GroupItem
 * - 支援故障轉移（優先級低的作為備份）
 * - 支援排除失敗的項目
 */

import type { Balancer } from './interface';
import type { Group, GroupItem } from '@/types/group';
import type { Bindings } from '@/types';
import { filterAvailableItems } from './interface';

/**
 * Failover 負載平衡器
 */
export class FailoverBalancer implements Balancer {
  constructor(_env: Bindings) {
    // Failover 模式不需要環境變數
  }

  /**
   * 選擇下一個 GroupItem（按優先級）
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

    // 按優先級排序（priority 越小優先級越高）
    const sortedItems = [...availableItems].sort((a, b) => {
      // 先按 priority 排序
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // priority 相同時按 id 排序
      return a.id - b.id;
    });

    // 返回優先級最高的項目
    return sortedItems[0]!;
  }

  /**
   * 重置（Failover 模式不需要狀態）
   */
  async reset(_groupId: number): Promise<void> {
    // Failover 模式無狀態，無需重置
  }
}
