/**
 * Group-related type definitions
 * Corresponds to internal/model/group.go in the original Go project
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

// Group update request
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
