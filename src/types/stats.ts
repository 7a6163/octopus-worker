/**
 * Statistics-related type definitions
 */

export interface StatsMetrics {
  inputToken: number;
  outputToken: number;
  inputCost: number;
  outputCost: number;
  waitTime: number;
  requestSuccess: number;
  requestFailed: number;
}

export interface StatsTotal extends StatsMetrics {
  id: number;
}

export interface StatsDaily extends StatsMetrics {
  date: string;
}

export interface StatsHourly extends StatsMetrics {
  hour: number;
  date: string;
}

export interface StatsModel extends StatsMetrics {
  id: number;
  name: string;
  channelId: number;
}

// Request attempt record
export interface AttemptRecord {
  round: number;
  attempt: number;
  success: boolean;
  error?: string;
  duration: number;
  timestamp: number;
}

// Stats update request
export interface StatsUpdateRequest {
  metrics: StatsMetrics;
  channelId?: number;
  modelKey?: string;
  apiKeyId?: number;
}
