import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { env } from '../lib/env';
import { initialCounters } from '../agent/limits';
import { assistantToolCallsMessage, userTextMessage } from '../agent/protocol';
import { PROMPT_VERSION } from '../agent/prompts';
import type { Diagram, JobStatus, JobView } from '@luma/shared';
import { db } from '../lib/db';
import { invalidFormat, notFound, conversationBusy, revisionConflict } from '../lib/errors';
import { presentDiagram } from '../lib/teaching-graphic';
import { taskFrameFrom } from '../agent/types';

/**
 * 生成任务状态（FR-11 / 设计文档 §8.3）。
 * 只读查询不触发模型；重试创建关联的新任务并把未完成的材料重新挂到新任务。
 */
export const jobService = {
  async get(userId: string, jobId: string): Promise<JobView> {
    const job = await db.generationJob.findFirst({
      where: { id: jobId, conversation: { userId } },
    });
    if (!job) throw notFound('任务');

    const error = job.error as { code?: string; message?: string; retryable?: boolean } | null;
    const checkpoint = job.draftCheckpoint as { lesson?: { title?: string; sections?: Array<{ id: string; heading: string; body: string; diagram?: Diagram }>; diagrams?: Array<{ sectionId: string; content: Diagram }> } } | null;
    const draft = job.type === 'lesson' && checkpoint?.lesson?.title && checkpoint.lesson.sections?.length
      ? { title: checkpoint.lesson.title, sections: checkpoint.lesson.sections.map(({ id, heading, body, diagram }) => ({ id, heading, body,
          ...(diagram ? { diagram } : { diagram: checkpoint.lesson!.diagrams?.find((item) => item.sectionId === id)?.content }),
        })) } : undefined;
    if (draft) await Promise.all(draft.sections.map(async (section) => {
      if (section.diagram) section.diagram = await presentDiagram(section.diagram);
    }));
    return {
      id: job.id,
      type: job.type,
      status: job.status as JobStatus,
      step: job.step,
      artifactId: job.resultArtifactId,
      draft,
      error: error
        ? {
            code: error.code ?? 'INTERNAL',
            message: error.message ?? '生成失败',
            retryable: error.retryable ?? false,
          }
        : null,
    };
  },

  /** 失败重试（FR-11）：新任务关联原任务；未完成的材料重新标记为生成中 */
  async retry(userId: string, jobId: string): Promise<JobView> {
    const job = await db.generationJob.findFirst({
      where: { id: jobId, conversation: { userId } },
    });
    if (!job) throw notFound('任务');
    if (job.status !== 'failed') throw invalidFormat('仅失败的任务可以重试');

    const newJob = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${job.conversationId} FOR UPDATE`;
      const existing = await tx.generationJob.findUnique({ where: { idempotencyKey: `retry:${job.id}` } });
      if (existing) return existing;
      const latest = await tx.subjectRevision.findFirst({ where: { subjectId: job.subjectId }, orderBy: { version: 'desc' } });
      if (!latest?.confirmedAt || latest.id !== job.subjectRevisionId) throw revisionConflict();
      const active = await tx.agentRun.findFirst({ where: { conversationId: job.conversationId, status: { in: ['running', 'waiting_job'] } } });
      if (active && active.id !== job.runId) throw conversationBusy();
      if (active) await tx.agentRun.update({ where: { id: active.id }, data: { status: 'cancelled', finishedAt: new Date() } });
      const original = job.runId ? await tx.agentRun.findUnique({ where: { id: job.runId } }) : null;
      if (!original) throw invalidFormat('原任务缺少运行记录，请重新生成');
      const originalFrame = taskFrameFrom(original.taskFrame);
      const callId = `retry_${randomUUID()}`;
      const toolName = job.type === 'lesson' ? 'createLesson' : 'createPractice';
      const payload = (job.payload ?? {}) as Record<string, unknown>;
      if (!payload.subjectText) throw invalidFormat('原任务缺少输入快照，请重新生成');
      const call = { toolCallId: callId, toolName, input: job.type === 'lesson' ? { target: String(payload.target ?? '生成讲义') } : { count: Number(payload.count ?? 2) } };
      const run = await tx.agentRun.create({ data: {
        conversationId: job.conversationId, subjectId: job.subjectId, subjectRevisionId: job.subjectRevisionId,
        requestId: `retry_${randomUUID()}`, status: 'waiting_job', promptVersion: PROMPT_VERSION,
        retryOfRunId: job.runId, userMessageId: original?.userMessageId,
        deadlineAt: new Date(Date.now() + env().TURN_TOTAL_MS), counters: initialCounters() as unknown as Prisma.InputJsonValue,
        protocol: [userTextMessage('重试刚才失败的材料任务'), assistantToolCallsMessage([call])] as unknown as Prisma.InputJsonValue,
        taskFrame: { ...originalFrame, kind: 'material', planned: true, historyCount: 0,
          goals: [{ type: job.type === 'lesson' ? 'lesson' : 'practice',
            ...(job.type === 'lesson' ? { target: String(payload.target ?? '生成讲义') } : { count: Number(payload.count ?? 2) }) }] } as unknown as Prisma.InputJsonValue,
      } });
      const retry = await tx.generationJob.create({ data: {
        type: job.type, conversationId: job.conversationId, subjectId: job.subjectId, subjectRevisionId: job.subjectRevisionId,
        runId: run.id, status: 'queued', idempotencyKey: `retry:${job.id}`, retryOfJobId: job.id,
        payload: job.payload as Prisma.InputJsonValue,
        deadlineAt: new Date(Date.now() + env().JOB_TOTAL_MS),
        draftCheckpoint: job.draftCheckpoint === null ? Prisma.DbNull : job.draftCheckpoint as Prisma.InputJsonValue,
      } });
      const decisionId = `${run.id}:retry`;
      await tx.toolExecution.create({ data: {
        runId: run.id, decisionId, toolCallId: callId, tool: toolName, batchOrder: 0,
        status: 'deferred', jobId: retry.id, idempotencyKey: `retry-tool:${retry.id}`,
      } });
      await tx.agentRun.update({ where: { id: run.id }, data: {
        waitingJobIds: [retry.id], pendingBatch: { decisionId, items: [call] },
      } });
      return retry;
    });
    return this.get(userId, newJob.id);
  },
};
