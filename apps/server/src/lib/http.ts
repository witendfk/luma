import { randomUUID } from 'node:crypto';
import { ErrorCode, type ErrorEnvelope } from '@luma/shared';
import { ZodError } from 'zod';
import { verifyToken } from './auth';
import { toApiError, unauthenticated } from './errors';

/**
 * 路由层封装：统一成功/失败响应形状、requestId 透传与鉴权。
 * 业务逻辑写在 services/，route 保持薄。
 */

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json({ ok: true, data }, init);
}

export async function withRoute(
  req: Request,
  fn: (ctx: { requestId: string }) => Promise<Response>,
): Promise<Response> {
  const requestId = req.headers.get('x-request-id') ?? randomUUID();
  try {
    const res = await fn({ requestId });
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (err) {
    if (err instanceof ZodError) {
      const detail = err.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      const body: ErrorEnvelope = {
        code: ErrorCode.INVALID_FORMAT,
        message: `参数校验失败：${detail}`,
        retryable: false,
        requestId,
      };
      return Response.json({ ok: false, error: body }, { status: 400 });
    }

    const apiErr = toApiError(err);
    if (apiErr.code === ErrorCode.INTERNAL) {
      console.error(`[api] ${req.method} ${new URL(req.url).pathname} 未处理错误`, err);
    }
    const body: ErrorEnvelope = {
      code: apiErr.code,
      message: apiErr.message,
      retryable: apiErr.retryable,
      requestId,
    };
    return Response.json({ ok: false, error: body }, { status: apiErr.status });
  }
}

/** 从 Authorization: Bearer 解析并校验登录态；所有受保护接口的入口（设计文档 §11） */
export async function requireUser(req: Request): Promise<{ userId: string }> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw unauthenticated('缺少登录凭据');
  const userId = await verifyToken(token);
  if (!userId) throw unauthenticated();
  return { userId };
}

export function bearerToken(req: Request): string {
  const header = req.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}
