import { api } from './client';

export interface ApiKey {
  id: number;
  name: string;
  api_key: string;
  enabled: boolean;
  expire_at: number;
  max_cost: number;
  supported_models: string;
}

export function listApiKeys(): Promise<ApiKey[]> {
  return api<ApiKey[]>('/api/v1/apikeys');
}

export function getApiKey(id: number): Promise<ApiKey> {
  return api<ApiKey>(`/api/v1/apikeys/${id}`);
}

export function createApiKey(data: Partial<ApiKey>): Promise<ApiKey> {
  return api<ApiKey>('/api/v1/apikeys', {
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
