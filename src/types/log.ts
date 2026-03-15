/**
 * Log-related type definitions
 */

import type { AttemptRecord } from './stats';

export interface RelayLog {
  id: number;
  time: number;
  requestModelName: string;
  channelId?: number;
  channelName?: string;
  actualModelName?: string;
  inputTokens: number;
  outputTokens: number;
  ftut: number; // First Token Use Time (milliseconds)
  useTime: number; // Total Use Time (milliseconds)
  cost: number;
  requestContent?: string;
  responseContent?: string;
  error?: string;
  attempts: AttemptRecord[];
  totalAttempts: number;
  successfulRound: number;
}

export interface RelayLogQueryRequest {
  page: number;
  pageSize: number;
  startTime?: number;
  endTime?: number;
  channelId?: number;
  modelName?: string;
  success?: boolean;
}

export interface RelayLogQueryResponse {
  total: number;
  logs: RelayLog[];
}
