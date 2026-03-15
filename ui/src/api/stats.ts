import { api } from './client';

export interface TodayStats {
  todayStart: number;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  avgUseTime: number;
}

export interface HourlyStat {
  hour: number;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}

export interface ChannelStat {
  channelId: number;
  channelName: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  avgUseTime: number;
}

export interface ApiKeyStat {
  apiKeyId: number;
  apiKeyName: string | null;
  inputToken: number;
  outputToken: number;
  inputCost: number;
  outputCost: number;
  waitTime: number;
  requestSuccess: number;
  requestFailed: number;
}

export interface ModelPrice {
  name: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function getToday(): Promise<TodayStats> {
  return api<TodayStats>('/api/v1/stats/today');
}

export function getHourly(): Promise<HourlyStat[]> {
  return api<HourlyStat[]>('/api/v1/stats/hourly');
}

export function getChannelStats(): Promise<ChannelStat[]> {
  return api<ChannelStat[]>('/api/v1/stats/channels');
}

export function getApiKeyStats(): Promise<ApiKeyStat[]> {
  return api<ApiKeyStat[]>('/api/v1/stats/apikeys');
}

export function getModelList(): Promise<ModelPrice[]> {
  return api<ModelPrice[]>('/api/v1/stats/model-list');
}

export function triggerPriceSync(): Promise<void> {
  return api<void>('/api/v1/stats/price-sync', { method: 'POST' });
}
