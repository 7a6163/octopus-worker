import { api } from './client';

export interface Channel {
  id: number;
  name: string;
  type: number;
  enabled: boolean;
  baseUrls: { url: string; delay: number }[];
  keys: { id: number; channelId: number; enabled: boolean; channelKey: string; remark: string; totalCost: number }[];
  model: string;
  customModel: string;
  proxy: boolean;
  autoSync: boolean;
  autoGroup: number;
  customHeader: { headerKey: string; headerValue: string }[];
  matchRegex: string;
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

export async function fetchModels(params: { base_url: string; key: string; type: number }): Promise<string[]> {
  const result = await api<{ models: string[] }>('/api/v1/channels/fetch-model', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return result.models;
}

export function syncChannels(): Promise<void> {
  return api<void>('/api/v1/channels/sync', { method: 'POST' });
}
