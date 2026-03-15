import { api } from './client';

export interface ApiKey {
  id: number;
  name: string;
  apiKey: string;
  enabled: boolean;
  expireAt: number;
  maxCost: number;
  supportedModels: string;
}

export function listApiKeys(): Promise<ApiKey[]> {
  return api<ApiKey[]>('/api/v1/apikeys');
}

export function getApiKey(id: number): Promise<ApiKey> {
  return api<ApiKey>(`/api/v1/apikeys/${id}`);
}

export function createApiKey(data: Partial<ApiKey>): Promise<{ id: number; apiKey: string }> {
  return api<{ id: number; apiKey: string }>('/api/v1/apikeys', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateApiKey(id: number, data: Partial<ApiKey>): Promise<ApiKey> {
  return api<ApiKey>(`/api/v1/apikeys/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteApiKey(id: number): Promise<void> {
  return api<void>(`/api/v1/apikeys/${id}`, { method: 'DELETE' });
}
