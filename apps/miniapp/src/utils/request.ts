import { API_BASE } from '@/config';
import { clearToken, getToken } from './token';

/**
 * 统一请求层：携带 Bearer 凭据与 requestId，解析服务端 { ok, data | error } 封装（设计文档 §10）。
 * UNAUTHENTICATED 时清除本地凭据，由页面层引导重新登录。
 */

export interface ApiFailure {
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly failure: ApiFailure,
    public readonly status?: number,
  ) {
    super(failure.message);
    this.name = 'ApiError';
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

let seq = 0;

function nextRequestId(): string {
  seq += 1;
  return `req_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface RequestOptions {
  /** 微信 wx.request 不支持 PATCH，需要部分更新时统一用 PUT */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  data?: unknown;
}

export function request<T>(opts: RequestOptions): Promise<T> {
  const token = getToken();
  if (token === 'luma-ui-preview-only') { clearToken(); return Promise.reject(new Error('请重新登录正式账号')); }
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: API_BASE + opts.path,
      method: opts.method,
      data: opts.data as Record<string, unknown> | undefined,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-request-id': nextRequestId(),
      },
      success: (res) => {
        const status = res.statusCode ?? 0;
        const body = res.data as Envelope<T> | undefined;
        if (status >= 200 && status < 300 && body?.ok === true) {
          resolve(body.data);
          return;
        }
        if (body?.ok === false && body.error) {
          if (body.error.code === 'UNAUTHENTICATED' && token === getToken()) clearToken();
          reject(new ApiError(body.error, status));
          return;
        }
        reject(
          new ApiError(
            { code: 'INVALID_RESPONSE', message: `服务返回异常（HTTP ${status}）`, retryable: false },
            status,
          ),
        );
      },
      fail: (err) => {
        reject(
          new ApiError({ code: 'NETWORK', message: err.errMsg ?? '网络请求失败', retryable: true }),
        );
      },
    });
  });
}
