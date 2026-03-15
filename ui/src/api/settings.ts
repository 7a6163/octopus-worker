import { api } from './client';

export interface Setting {
  key: string;
  value: string;
}

export function getSettings(): Promise<Setting[]> {
  return api<Setting[]>('/api/v1/settings');
}

export function updateSetting(key: string, value: string): Promise<void> {
  return api<void>(`/api/v1/settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}
