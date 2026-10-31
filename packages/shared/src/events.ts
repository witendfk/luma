import { z } from 'zod';
import { ArtifactType, JobStatus, PublishStatus } from './enums';
import { ErrorCode } from './errors';

/**
 * 对话流式事件（设计文档 §10）。
 * 微信端通过 wx.request enableChunked 接收 text/event-stream，
 * 事件名与此处 type 一致，只含学生可见内容，不含模型内部推理。
 */
export const RunId = z.string().min(1);

export const RunStartedEvent = z.object({
  type: z.literal('run.started'),
  runId: RunId,
});

export const TextDeltaEvent = z.object({
  type: z.literal('text.delta'),
  runId: RunId,
  /** 增量文本（Markdown + LaTeX 源文本） */
  delta: z.string(),
});

export const ToolStartedEvent = z.object({
  type: z.literal('tool.started'),
  runId: RunId,
  toolExecutionId: z.string(),
  tool: z.string(),
});

export const ToolFinishedEvent = z.object({
  type: z.literal('tool.finished'),
  runId: RunId,
  toolExecutionId: z.string(),
  ok: z.boolean(),
});

export const ArtifactUpdatedEvent = z.object({
  type: z.literal('artifact.updated'),
  runId: RunId,
  artifactId: z.string(),
  artifactType: z.enum([ArtifactType.lesson, ArtifactType.exercise_set]),
  status: z.enum([PublishStatus.generating, PublishStatus.published, PublishStatus.failed]),
});

export const RunCompletedEvent = z.object({
  type: z.literal('run.completed'),
  runId: RunId,
  /** 本轮结束时的教学阶段，供前端同步进度 */
  stage: z.string().optional(),
});

export const RunFailedEvent = z.object({
  type: z.literal('run.failed'),
  runId: RunId,
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

export const RunCancelledEvent = z.object({
  type: z.literal('run.cancelled'),
  runId: RunId,
});

export const StreamEvent = z.discriminatedUnion('type', [
  RunStartedEvent,
  TextDeltaEvent,
  ToolStartedEvent,
  ToolFinishedEvent,
  ArtifactUpdatedEvent,
  RunCompletedEvent,
  RunFailedEvent,
  RunCancelledEvent,
]);
export type StreamEvent = z.infer<typeof StreamEvent>;

export type StreamEventType = StreamEvent['type'];

/** 任务状态投影（GET /jobs/:id 返回），页面轮询用 */
export const JobView = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum([
    JobStatus.queued,
    JobStatus.running,
    JobStatus.succeeded,
    JobStatus.failed,
    JobStatus.cancelled,
    JobStatus.superseded,
  ]),
  /** 当前步骤描述，如「生成正文」「生成配图」「复核」 */
  step: z.string().nullable(),
  artifactId: z.string().nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .nullable(),
});
export type JobView = z.infer<typeof JobView>;

/** 断言工具：服务端发事件前校验，小程序收到后解析 */
export function parseStreamEvent(raw: string): StreamEvent {
  return StreamEvent.parse(JSON.parse(raw));
}

export { ErrorCode };
