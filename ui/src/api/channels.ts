import { api } from './client';

export interface Channel {
  id: number;
  name: string;
  type: number;
  enabled: boolean;
  base_urls: { url: string; delay: number }[];
  keys: { id: number; channel_id: number; enabled: boolean; channel_key: string; remark: string; total_cost: number }[];
  model: string;
  custom_model: string;
  proxy: boolean;
  auto_sync: boolean;
  auto_group: number;
  custom_header: { headerKey: string; headerValue: string }[];
  match_regex: string;
}

export function listChannels(): Promise<Channel[]> {
  return api<Channel[]>('/api/v1/channels');
}

export function getChannel(id: number): Promise<Channel> {
  return api<Channel>(`/api/v1/channels/${id}`);
}

export function createChannel(data: Partial<Channel> & { keys_to_add?: { enabled: boolean; channel_key: string; remark: string }[] }): Promise<Channel> {
  return api<Channel>('/api/v1/channels', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateChannel(id: number, data: Partial<Channel>): Promise<Channel> {
  return api<Channel>(`/api/v1/channels/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteChannel(id: number): Promise<void> {
  return api<void>(`/api/v1/channels/${id}`, { method: 'DELETE' });
}

export function fetchModels(params: { base_url: string; key: string; type: number }): Promise<string[]> {
  return api<string[]>('/api/v1/channels/fetch-model', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function syncChannels(): Promise<void> {
  return api<void>('/api/v1/channels/sync', { method: 'POST' });
}
