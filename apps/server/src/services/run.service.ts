import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { TurnRequest } from '@luma/shared';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { invalidFormat, notFound, revisionConflict } from '../lib/errors';
import type { EventEmitter } from '../lib/sse';
import { activeControllers } from '../agent/run-guard';
import { textOf } from '../agent/blocks';
import { initialCounters } from '../agent/limits';
import { userTextMessage } from '../agent/protocol';
import { PROMPT_VERSION } from '../agent/prompts';
import type { TaskFrame, TaskFrameGoal } from '../agent/types';
import { conversationService } from './conversation.service';
import { createConversationTitle } from '../lib/conversation-title';

/**
 * 运行服务（设计文档 §4.5 / §4.9 / §10）：
 * 运行创建（幂等）、旧输入暂停、终态取消、重复请求重放。
 */
export const runService = {
  async startRun(userId: string, conversationId: string, input: TurnRequest) {
    await conversationService.getOwned(userId, conversationId);

    if (!input.text?.trim() && !input.imageAttachmentIds?.length && !input.action) throw invalidFormat('消息不能为空');
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      // 同请求幂等依赖数据库唯一约束（§4.9）：重复请求返回已有运行引用
      const existing = await tx.agentRun.findUnique({
        where: { conversationId_requestId: { conversationId, requestId: input.requestId } },
      });
      if (existing) return { run: existing, existing: true as const };

      // 学生在旧运行等待时发来新输入：暂停原运行自动续接；已授权的旧材料任务继续保存成果（§4.5）
      await tx.agentRun.updateMany({
        where: { conversationId, status: { in: ['running', 'waiting_job'] } },
        data: {
          status: 'cancelled',
          error: { code: 'REPLACED', message: '学生发来新输入，本次运行停止自动续接', retryable: false },
          finishedAt: new Date(),
        },
      });

      if (!input.text && !input.imageAttachmentIds?.length && !input.action) {
        throw invalidFormat('消息不能为空');
      }

      let subject = await tx.subjectRevision.findFirst({
        where: { conversationId },
        orderBy: { version: 'desc' },
      });

      if (input.expectedRevision !== undefined && subject && input.expectedRevision !== subject.version) throw revisionConflict();
      if (!subject && input.text?.trim()) {
        subject = await tx.subjectRevision.create({
          data: { conversationId, version: 1, type: 'question', content: { text: input.text.trim() }, tags: [] },
        });
        await tx.learningProgress.upsert({
          where: { conversationId }, update: { subjectRevisionId: subject.id, stage: 'clarifying' },
          create: { conversationId, subjectRevisionId: subject.id, stage: 'clarifying' },
        });
        await tx.conversation.updateMany({ where: { id: conversationId, title: '新对话' }, data: { title: createConversationTitle(input.text) } });
      }
      const recent = await tx.message.findMany({
        where: { conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 12,
      });
      const history = recent.reverse().map((m) => ({ role: m.role, content: textOf(m.content).slice(0, 6000) })).filter((m) => m.content);

      // 用户消息幂等落库（§9.1：重试不重复创建用户消息）
      const blocks: unknown[] = [];
      if (input.text) blocks.push({ type: 'text', text: input.text });
      if (input.imageAttachmentIds?.length) {
        blocks.push({ type: 'image', attachmentIds: input.imageAttachmentIds });
      }
      let userMessage = await tx.message.findUnique({
        where: { conversationId_requestId: { conversationId, requestId: input.requestId } },
      });
      if (!userMessage) {
        userMessage = await tx.message.create({
          data: { conversationId, role: 'user', content: { blocks } as Prisma.InputJsonValue, requestId: input.requestId },
        });
      }

      // TaskFrame（§4.3）：目标来自学生本次请求，不自行扩充
      const goals: TaskFrameGoal[] = [];
      if (input.action === 'generate_lesson') {
        goals.push({ type: 'lesson', target: input.text?.slice(0, 200) ?? '按已确认范围生成讲义' });
      }
      if (input.action === 'generate_practice') {
        goals.push({ type: 'practice', count: 2 });
      }
      const taskFrame: TaskFrame = {
        kind: input.action === 'show_solution' ? 'solution' : goals.length > 0 ? 'material' : 'chat',
        action: input.action,
        focus: {
          artifactId: input.artifactId,
          sectionId: input.sectionId,
          attemptId: input.attemptId,
          exerciseId: input.exerciseId,
        },
        goals,
      };

      const run = await tx.agentRun.create({
        data: {
          conversationId,
          subjectRevisionId: subject?.id,
          requestId: input.requestId,
          status: 'running',
          promptVersion: PROMPT_VERSION,
          taskFrame: taskFrame as unknown as Prisma.InputJsonValue,
          protocol: [...history, userTextMessage(input.text || (input.action ? `学生操作：${input.action}` : ''), input.imageAttachmentIds ?? [])] as unknown as Prisma.InputJsonValue,
          counters: initialCounters() as unknown as Prisma.InputJsonValue,
          deadlineAt: new Date(Date.now() + env().TURN_TOTAL_MS),
          retryOfRunId: input.retryOfRunId,
          userMessageId: userMessage.id,
          inputDigest: input.text ? createHash('sha256').update(input.text).digest('hex').slice(0, 32) : null,
        },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { lastActiveAt: new Date() } });
      return { run, existing: false as const };
    });
  },

  /** 重复请求重放（§10）：已完成结果按存储内容重放，运行中仅返回引用，不再触发模型 */
  async replay(runId: string, emit: EventEmitter): Promise<void> {
    const run = await db.agentRun.findUnique({ where: { id: runId } });
    if (!run) {
      emit({ type: 'run.failed', runId, error: { code: 'NOT_FOUND', message: '运行不存在', retryable: false } });
      return;
    }
    emit({ type: 'run.started', runId });
    const assistant = await db.message.findFirst({
      where: { runId, role: 'assistant' },
      orderBy: { id: 'desc' },
    });
    if (assistant) {
      const text = textOf(assistant.content);
      if (text) emit({ type: 'text.delta', runId, delta: text });
    }
    switch (run.status) {
      case 'completed':
        emit({ type: 'run.completed', runId });
        break;
      case 'waiting_user':
        emit({ type: 'run.waiting', runId, waiting: 'user', jobIds: [] });
        break;
      case 'waiting_job':
        emit({ type: 'run.waiting', runId, waiting: 'job', jobIds: run.waitingJobIds });
        break;
      case 'failed': {
        const e = run.error as { code?: string; message?: string; retryable?: boolean } | null;
        emit({
          type: 'run.failed',
          runId,
          error: { code: e?.code ?? 'INTERNAL', message: e?.message ?? '运行失败', retryable: e?.retryable ?? true },
        });
        break;
      }
      case 'cancelled':
        emit({ type: 'run.cancelled', runId });
        break;
      default:
        emit({ type: 'run.failed', runId, error: { code: 'RUN_INTERRUPTED', message: '运行中断，可重试', retryable: true } });
    }
  },

  /** 取消运行及关联未完成任务（§10）；迟到结果由发布前核验拦截（§8.4） */
  async cancel(userId: string, runId: string) {
    const run = await db.agentRun.findFirst({
      where: { id: runId, conversation: { userId } },
    });
    if (!run) throw notFound('运行');
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${run.conversationId} FOR UPDATE`;
      const runResult = await tx.agentRun.updateMany({
        where: { id: runId, status: { in: ['running', 'waiting_job'] } },
        data: { status: 'cancelled', finishedAt: new Date() },
      });
      const jobs = await tx.generationJob.updateMany({
        where: { runId, status: { in: ['queued', 'running'] } },
        data: { status: 'cancelled' },
      });
      return { cancelled: runResult.count > 0, cancelledJobs: jobs.count };
    });
    activeControllers.get(runId)?.abort(new Error('学生已取消'));
    return result;
  },
};
