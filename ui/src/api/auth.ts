import { api, setToken } from './client';

interface LoginResponse {
  token: string;
  user: { id: number; username: string; role: string };
}

interface MeResponse {
  id: number;
  username: string;
  role: string;
}

interface RefreshResponse {
  token: string;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const data = await api<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data;
}

export async function getMe(): Promise<MeResponse> {
  return api<MeResponse>('/api/v1/auth/me');
}

export async function refreshToken(): Promise<void> {
  const data = await api<RefreshResponse>('/api/v1/auth/refresh', {
    method: 'POST',
  });
  setToken(data.token);
}
