/**
 * User 相關類型定義
 */

export interface User {
  id: number;
  username: string;
  password: string;
  role: 'admin' | 'user';
  enabled: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  username: string;
}

export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}
