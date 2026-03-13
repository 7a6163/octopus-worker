/**
 * Group 相關類型定義
 * 對應原始 Go 專案的 internal/model/group.go
 */

export enum GroupMode {
  RoundRobin = 1,
  Random = 2,
  Failover = 3,
  Weighted = 4,
}

export interface Group {
  id: number;
  name: string;
  mode: GroupMode;
  matchRegex: string;
  firstTokenTimeOut: number;
  items: GroupItem[];
}

export interface GroupItem {
  id: number;
  groupId: number;
  channelId: number;
  modelName: string;
  priority: number;
  weight: number;
}

// 分組更新請求
export interface GroupUpdateRequest {
  id: number;
  name?: string;
  mode?: GroupMode;
  matchRegex?: string;
  firstTokenTimeOut?: number;
  itemsToAdd?: GroupItemAddRequest[];
  itemsToUpdate?: GroupItemUpdateRequest[];
  itemsToDelete?: number[];
}

export interface GroupItemAddRequest {
  channelId: number;
  modelName: string;
  priority: number;
  weight: number;
}

export interface GroupItemUpdateRequest {
  id: number;
  channelId?: number;
  modelName?: string;
  priority?: number;
  weight?: number;
}
