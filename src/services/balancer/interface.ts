/**
 * 負載平衡器介面
 * 對應原始 Go 專案的 internal/balancer/interface.go
 */

import type { Group, GroupItem } from '@/types/group';
import { GroupMode } from '@/types/group';
import type { Bindings } from '@/types';

/**
 * 負載平衡器介面
 */
export interface Balancer {
  /**
   * 選擇下一個 GroupItem
   * @param group 模型分組
   * @param excludeIds 需要排除的 GroupItem ID（已失敗的項目）
   * @returns 選中的 GroupItem 或 null
   */
  selectNext(group: Group, excludeIds?: Set<number>): Promise<GroupItem | null>;

  /**
   * 重置負載平衡器狀態
   * @param groupId Group ID
   */
  reset(groupId: number): Promise<void>;
}

// 導入所有負載平衡器
import { RoundRobinBalancer } from './round-robin';
import { RandomBalancer } from './random';
import { FailoverBalancer } from './failover';
import { WeightedBalancer } from './weighted';

/**
 * 負載平衡器工廠
 * @param mode 負載平衡模式
 * @param env Cloudflare Workers 環境綁定
 * @returns 對應的負載平衡器實例
 */
export function getBalancer(mode: GroupMode, env: Bindings): Balancer {
  switch (mode) {
    case GroupMode.RoundRobin:
      return new RoundRobinBalancer(env);
    case GroupMode.Random:
      return new RandomBalancer(env);
    case GroupMode.Failover:
      return new FailoverBalancer(env);
    case GroupMode.Weighted:
      return new WeightedBalancer(env);
    default:
      // 預設使用 RoundRobin
      return new RoundRobinBalancer(env);
  }
}

/**
 * 輔助函數：過濾可用的 GroupItems
 * @param items 所有 GroupItems
 * @param excludeIds 需要排除的 ID
 * @returns 可用的 GroupItems
 */
export function filterAvailableItems(
  items: GroupItem[],
  excludeIds?: Set<number>
): GroupItem[] {
  if (!excludeIds || excludeIds.size === 0) {
    return items;
  }

  return items.filter((item) => !excludeIds.has(item.id));
}
