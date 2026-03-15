import { api } from './client';

export interface TodayStats {
  requests: number;
  tokens: number;
  cost: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface HourlyStat {
  hour: number;
  requests: number;
  tokens: number;
  cost: number;
}

export interface ChannelStat {
  channel_id: number;
  channel_name: string;
  requests: number;
  tokens: number;
  cost: number;
}

export interface ApiKeyStat {
  api_key_id: number;
  api_key_name: string;
  requests: number;
  tokens: number;
  cost: number;
}

export interface ModelPrice {
  name: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
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
