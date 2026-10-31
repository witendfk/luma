const KEY = 'luma_token';
const clearListeners = new Set<() => void>();
let version = 0;

export const sessionVersion = (): number => version;

export function onSessionCleared(listener: () => void): () => void {
  clearListeners.add(listener);
  return () => { clearListeners.delete(listener); };
}

/** 应用会话凭据的受控本地存储（设计文档 §11：不放 URL，过期后重新微信登录） */

export function getToken(): string | null {
  try {
    return (uni.getStorageSync(KEY) as string) || null;
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (getToken() !== token) clearToken();
  uni.setStorageSync(KEY, token);
}

export function clearToken(): void {
  version += 1;
  try {
    uni.removeStorageSync(KEY);
    for (const key of uni.getStorageInfoSync().keys) {
      if (key.startsWith('luma_draft:')) uni.removeStorageSync(key);
    }
  } catch {
    // 本地存储失败也必须清空内存、终止旧账号请求。
  }
  for (const listener of clearListeners) {
    try { listener(); } catch (err) { console.error('[session] 清理失败', err); }
  }
}
