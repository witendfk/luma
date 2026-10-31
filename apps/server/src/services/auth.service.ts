import { getMe, revokeToken, wechatLogin, type LoginResult } from '../lib/auth';

export const authService = {
  /** FR-01：微信 code 换 openid 并签发应用会话凭据 */
  login(code: string): Promise<LoginResult> {
    return wechatLogin(code);
  },

  me(userId: string) {
    return getMe(userId);
  },

  /** 退出使登录态失效（FR-01：退出后不能继续访问该账号资料） */
  async logout(token: string): Promise<void> {
    await revokeToken(token);
  },
};
