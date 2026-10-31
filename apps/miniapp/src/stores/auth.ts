import { defineStore } from 'pinia';
import { onScopeDispose, ref } from 'vue';
import * as authApi from '@/api/auth';
import { clearToken, getToken, onSessionCleared, sessionVersion, setToken } from '@/utils/token';

/** 登录态与账号信息（FR-01）：退出后清凭据，重新登录同账号数据可恢复 */
export const useAuthStore = defineStore('auth', () => {
  const nickname = ref<string | null>(null);
  const avatarUrl = ref<string | null>(null);
  const loggedIn = ref(false);
  let loginVersion = 0;

  onScopeDispose(onSessionCleared(() => {
    loginVersion += 1;
    loggedIn.value = false;
    nickname.value = null;
    avatarUrl.value = null;
  }));

  async function loginWithCode(code: string): Promise<void> {
    const pendingLogin = ++loginVersion;
    const result = await authApi.login(code);
    if (pendingLogin !== loginVersion) throw new Error('登录状态已变化，请重试');
    setToken(result.token);
    await refreshMe();
    if (getToken() !== result.token || !loggedIn.value) throw new Error('登录状态已变化，请重试');
  }

  async function refreshMe(): Promise<void> {
    if (!getToken()) {
      clearToken();
      return;
    }
    const version = sessionVersion();
    try {
      const info = await authApi.me();
      if (version !== sessionVersion()) return;
      nickname.value = info.nickname;
      avatarUrl.value = info.avatarUrl;
      loggedIn.value = true;
    } catch (err) {
      if (version !== sessionVersion()) return;
      loggedIn.value = false;
      throw err;
    }
  }

  async function logout(): Promise<void> {
    // 发起撤销请求后立即清理本地，不等网络返回才隐藏旧账号内容。
    const revocation = authApi.logout();
    clearToken();
    await revocation;
  }

  return { nickname, avatarUrl, loggedIn, loginWithCode, refreshMe, logout };
});
