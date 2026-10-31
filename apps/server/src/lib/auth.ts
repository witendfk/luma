import { createHash, randomBytes } from 'node:crypto';
import { ErrorCode } from '@luma/shared';
import { db } from './db';
import { env } from './env';
import { ApiError, invalidFormat } from './errors';

/**
 * 登录与会话凭据（FR-01 / 设计文档 §11）。
 * 库里只存凭据摘要；token 原文仅返回一次给小程序，请求头 Bearer 携带。
 */

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

interface WechatCodeSession {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

export interface LoginResult {
  userId: string;
  token: string;
  expiresAt: Date;
}

export async function wechatLogin(code: string): Promise<LoginResult> {
  const openid = await resolveOpenid(code);
  const user = await db.user.upsert({ where: { openid }, update: {}, create: { openid } });
  return issueSession(user.id);
}

async function resolveOpenid(code: string): Promise<string> {
  const e = env();

  // 开发模式：跳过微信校验，便于本机联调；不得用于交付环境（设计文档 §6）
  if (e.LUMA_DEV_FAKE_LOGIN) {
    if (e.NODE_ENV !== 'development' || !/^dev:[A-Za-z0-9_-]{1,64}$/.test(code)) {
      throw invalidFormat('开发登录凭证必须为 dev:<1 至 64 位字母、数字、下划线或短横线>');
    }
    // 与真实微信身份隔离，避免开发输入碰撞到真实账号。
    return code;
  }

  if (!e.WECHAT_APPID || !e.WECHAT_APP_SECRET) {
    throw new ApiError(ErrorCode.INTERNAL, '微信登录未配置（WECHAT_APPID / WECHAT_APP_SECRET）', 500);
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', e.WECHAT_APPID);
  url.searchParams.set('secret', e.WECHAT_APP_SECRET);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const resp = await fetch(url);
  if (!resp.ok) throw new ApiError(ErrorCode.UNAUTHENTICATED, '微信登录服务暂不可用', 502, true);

  const data = (await resp.json()) as WechatCodeSession;
  if (!data.openid) {
    throw new ApiError(ErrorCode.UNAUTHENTICATED, `微信登录失败：${data.errmsg ?? 'code 无效'}`, 401);
  }
  // AppSecret 与 session_key 不下发、不落库（设计文档 §11）
  return data.openid;
}

export async function issueSession(userId: string): Promise<LoginResult> {
  const token = `lum_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await db.authSession.create({
    data: { userId, tokenHash: sha256(token), expiresAt },
  });
  return { userId, token, expiresAt };
}

export async function verifyToken(token: string): Promise<string | null> {
  const session = await db.authSession.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  return session.userId;
}

export async function revokeToken(token: string): Promise<void> {
  await db.authSession.updateMany({
    where: { tokenHash: sha256(token) },
    data: { revokedAt: new Date() },
  });
}

export async function getMe(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, nickname: true, avatarUrl: true, createdAt: true },
  });
}
