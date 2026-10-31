import { z } from 'zod';

/**
 * 错误码 —— 设计文档 §10：区分未登录、无权限、版本已更新、会话忙碌、
 * 格式错误、超限、模型不可用及生成中断。
 */
export const ErrorCode = {
  /** 未登录或登录态过期 */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** 无权限访问他人数据 */
  FORBIDDEN: 'FORBIDDEN',
  /** expectedRevision 不匹配，来源已更新 */
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  /** 同一会话已有生成在跑 */
  CONVERSATION_BUSY: 'CONVERSATION_BUSY',
  /** 请求格式或参数校验失败 */
  INVALID_FORMAT: 'INVALID_FORMAT',
  /** 频率或用量超限 */
  RATE_LIMITED: 'RATE_LIMITED',
  /** 模型服务不可用 */
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  /** 生成任务中断（进程重启等） */
  GENERATION_INTERRUPTED: 'GENERATION_INTERRUPTED',
  /** 资源不存在 */
  NOT_FOUND: 'NOT_FOUND',
  /** 功能尚未实现（脚手架阶段） */
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  /** 未分类服务端错误 */
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 统一错误响应（设计文档 §10）：code + 可读 message + retryable + 请求引用 */
export const ErrorEnvelope = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  requestId: z.string().optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
