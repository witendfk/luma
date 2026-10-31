import { ErrorCode } from '@luma/shared';

/**
 * 业务错误：route 层统一捕获并转为 §10 的错误响应（code/message/retryable/requestId）。
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const unauthenticated = (message = '未登录或登录态已过期') =>
  new ApiError(ErrorCode.UNAUTHENTICATED, message, 401);

export const forbidden = (message = '无权访问该资源') =>
  new ApiError(ErrorCode.FORBIDDEN, message, 403);

export const notFound = (what: string) =>
  new ApiError(ErrorCode.NOT_FOUND, `${what}不存在`, 404);

/** 同一会话同时只允许一轮生成（设计文档 §4.3） */
export const conversationBusy = () =>
  new ApiError(ErrorCode.CONVERSATION_BUSY, '当前对话正在生成回复，请稍候', 409, true);

/** 来源已更新：客户端需刷新后重试（设计文档 §10 expectedRevision） */
export const revisionConflict = (message = '题目内容已更新，请刷新后重试') =>
  new ApiError(ErrorCode.REVISION_CONFLICT, message, 409);

export const invalidFormat = (message: string) =>
  new ApiError(ErrorCode.INVALID_FORMAT, message, 400);

export const notImplemented = (what: string) =>
  new ApiError(ErrorCode.NOT_IMPLEMENTED, `${what}尚未实现（脚手架阶段）`, 501);

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(ErrorCode.INTERNAL, '服务内部错误', 500);
}
