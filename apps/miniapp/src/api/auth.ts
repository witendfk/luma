import { request } from '@/utils/request';

/** 鉴权接口（FR-01） */

export interface LoginResult {
  userId: string;
  token: string;
  expiresAt: string;
}

export interface MeInfo {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export function login(code: string): Promise<LoginResult> {
  return request<LoginResult>({ method: 'POST', path: '/api/auth/wechat/login', data: { code } });
}

export function me(): Promise<MeInfo> {
  return request<MeInfo>({ method: 'GET', path: '/api/auth/me' });
}

export function logout(): Promise<{ loggedOut: boolean }> {
  return request<{ loggedOut: boolean }>({ method: 'POST', path: '/api/auth/logout' });
}
