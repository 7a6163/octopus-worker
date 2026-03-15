import { api } from './client';

export interface User {
  id: number;
  username: string;
  role: string;
  enabled: boolean;
}

export function listUsers(): Promise<User[]> {
  return api<User[]>('/api/v1/users');
}

export function getUser(id: number): Promise<User> {
  return api<User>(`/api/v1/users/${id}`);
}

export function createUser(data: { username: string; password: string; role: string; enabled?: boolean }): Promise<User> {
  return api<User>('/api/v1/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateUser(id: number, data: Partial<User & { password?: string }>): Promise<User> {
  return api<User>(`/api/v1/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteUser(id: number): Promise<void> {
  return api<void>(`/api/v1/users/${id}`, { method: 'DELETE' });
}
