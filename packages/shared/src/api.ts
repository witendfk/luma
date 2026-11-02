import { z } from 'zod';
import { ExplicitAction } from './enums';

/**
 * API 请求/响应核心契约（设计文档 §10）。
 * 首期只沉淀最核心的一轮对话与通用分页结构，其余接口契约随开发补充到本文件。
 */

/** POST /conversations/:id/turns 的一轮输入（设计文档 §4.1） */
export const TurnRequest = z.object({
  /** 幂等标识：同一请求重试复用，学生发起新操作生成新标识 */
  requestId: z.string().min(8).max(64),
  /** 学生输入文字（可与图片同时为空？不允许——至少一项） */
  text: z.string().max(8000).optional(),
  /** 上传完成的图片附件 */
  imageAttachmentIds: z.array(z.string()).max(4).optional(),
  /** 明确操作；自由输入时不传，由服务端判定意图 */
  action: z.nativeEnum(ExplicitAction).optional(),
  /** 客户端已知的题目版本，冲突时返回 REVISION_CONFLICT */
  expectedRevision: z.number().int().optional(),
  /** 携题追问的上下文引用 */
  artifactId: z.string().optional(),
  sectionId: z.string().optional(),
  attemptId: z.string().optional(),
  exerciseId: z.string().optional(),
  /** 显式重试来源运行（设计文档 §10：显式重试携带新 requestId 及 retryOfRunId） */
  retryOfRunId: z.string().optional(),
});
export type TurnRequest = z.infer<typeof TurnRequest>;

/** 分页查询通用参数 */
export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** 游标分页通用响应 */
export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

/** 统一响应包装：数据或错误二选一，HTTP 状态码配合使用 */
export const ApiBody = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
      requestId: z.string().optional(),
    }),
  }),
]);
