import { initialReadback } from '../agent/readback';
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
import { taskFrameFrom, type TaskFrame, type TaskFrameGoal } from '../agent/types';
import { conversationService } from './conversation.service';
import { resolveSubject, latestRevision } from './subject-context';
import { validateFocus } from './focus';
import { createConversationTitle } from '../lib/conversation-title';
import { practiceSource } from './lesson-practice';
import { ContentProfileRef } from '../agent/content-profile';

/**
 * 运行服务（设计文档 §4.5 / §4.9 / §10）：
 * 运行创建（幂等）、旧输入暂停、终态取消、重复请求重放。
 */
export const runService = {
  async startRun(userId: string, conversationId: string, input: TurnRequest) {
    await conversationService.getOwned(userId, conversationId);

    if (!input.retryOfRunId && !input.text?.trim() && !input.imageAttachmentIds?.length && !input.action) throw invalidFormat('消息不能为空');
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      // 同请求幂等依赖数据库唯一约束（§4.9）：重复请求返回已有运行引用
      const existing = await tx.agentRun.findUnique({
        where: { conversationId_requestId: { conversationId, requestId: input.requestId } },
      });
      if (existing) return { run: existing, existing: true as const };

      // Retry reuses an owned original message, never accepts replacement text/focus from the client.
      const source = input.retryOfRunId ? await tx.agentRun.findFirst({ where: {
        id: input.retryOfRunId, conversationId, conversation: { userId },
      }, include: { userMessage: true } }) : null;
      if (input.retryOfRunId && !source) throw notFound('重试来源');
      if (source) {
        if (!['failed', 'cancelled'].includes(source.status) || !source.userMessage) throw invalidFormat('只能重试已失败或停止的回复');
        const sourceFrame = taskFrameFrom(source.taskFrame);
        const original = source.userMessage.content as { blocks?: Array<{ type: string; attachmentIds?: string[] }> };
        input = { requestId: input.requestId, retryOfRunId: source.id, subjectId: source.subjectId,
          text: textOf(source.userMessage.content), action: sourceFrame.action, ...sourceFrame.focus,
          imageAttachmentIds: original.blocks?.find((b) => b.type === 'image')?.attachmentIds };
        const newerInput = await tx.message.findFirst({ where: { conversationId, subjectId: source.subjectId, role: 'user',
          OR: [{ createdAt: { gt: source.userMessage.createdAt } }, { createdAt: source.userMessage.createdAt, id: { gt: source.userMessage.id } }] } });
        if (newerInput) throw revisionConflict('已有后续提问，请继续当前对话，不重试旧回复');
      }

      const object = await resolveSubject(tx, conversationId, input.subjectId);
      const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      if (conversation.activeSubjectId !== object.id) throw revisionConflict('当前题目已切换，请刷新后重试');
      let subject = await latestRevision(tx, object.id);
      if (source && source.subjectRevisionId !== (subject?.id ?? null)) throw revisionConflict();
      if (source) {
        const previousRetry = await tx.agentRun.findFirst({ where: { retryOfRunId: source.id }, orderBy: { startedAt: 'desc' } });
        if (previousRetry) return { run: previousRetry, existing: true as const };
      }
      if (input.expectedRevision !== undefined && input.expectedRevision !== subject?.version) throw revisionConflict();
      if (!subject && input.text?.trim()) {
        subject = await tx.subjectRevision.create({
          data: { conversationId, subjectId: object.id, version: 1, type: 'question', content: { text: input.text.trim() }, tags: [] },
        });
        await tx.learningProgress.update({ where: { subjectId: object.id }, data: { subjectRevisionId: subject.id, stage: 'clarifying', version: { increment: 1 } } });
        await tx.conversation.updateMany({ where: { id: conversationId, title: '新对话' }, data: { title: createConversationTitle(input.text) } });
      }
      if (subject) await validateFocus(tx, userId, conversationId, subject.id, input);
      else if (input.artifactId || input.attemptId || input.exerciseId || input.sectionId) throw invalidFormat('请先提供学习内容');
      if (input.practiceMode) {
        if (input.action !== 'generate_practice' || !input.artifactId || !input.artifactVersion || input.sectionId || input.attemptId || input.exerciseId) throw invalidFormat('配套练习入口需要完整讲义来源');
        await practiceSource(tx, userId, input.artifactId, input.artifactVersion);
      }
      const focus = { artifactId: input.artifactId, artifactVersion: input.artifactVersion, sectionId: input.sectionId, attemptId: input.attemptId, exerciseId: input.exerciseId };
      // The driver loads raw history and its rolling checkpoint outside this short write transaction.
      // Never silently drop the oldest messages before they can be summarized.
      const history: import('../lib/model').ModelMessage[] = [];
      await tx.agentRun.updateMany({ where: { conversationId, status: { in: ['running', 'waiting_job'] } },
        data: { status: 'cancelled', error: { code: 'REPLACED', message: '新的输入停止了旧运行自动续接', retryable: false }, finishedAt: new Date() } });

      // 用户消息幂等落库（§9.1：重试不重复创建用户消息）
      const blocks: unknown[] = [];
      if (input.text) blocks.push({ type: 'text', text: input.text });
      if (input.imageAttachmentIds?.length) {
        blocks.push({ type: 'image', attachmentIds: input.imageAttachmentIds });
      }
      let userMessage = source?.userMessage ?? await tx.message.findUnique({
        where: { conversationId_requestId: { conversationId, requestId: input.requestId } },
      });
      if (!userMessage) {
        userMessage = await tx.message.create({
          data: { conversationId, subjectId: object.id, subjectRevisionId: subject?.id, role: 'user', content: { blocks, focus } as Prisma.InputJsonValue, requestId: input.requestId },
        });
        // Count help only after a real student turn is accepted, not when opening the question composer.
        if (input.attemptId && input.exerciseId && input.action !== 'show_solution') {
          await tx.$queryRaw`SELECT id FROM "PracticeAttempt" WHERE id = ${input.attemptId} FOR UPDATE`;
          const attempt = await tx.practiceAttempt.findFirst({ where: { id: input.attemptId, userId, stage: 'doing' } });
          if (attempt) await tx.practiceAnswer.upsert({ where: { attemptId_exerciseId: { attemptId: attempt.id, exerciseId: input.exerciseId } },
            create: { attemptId: attempt.id, exerciseId: input.exerciseId, hintsUsed: 1 }, update: { hintsUsed: { increment: 1 } } });
        }

      }

      const previousTurn = subject ? await tx.agentRun.findFirst({ where: { conversationId, subjectRevisionId: subject.id,
        status: { in: ['completed', 'waiting_user'] } }, orderBy: { startedAt: 'desc' }, select: { taskFrame: true } }) : null;
      const previousProfile = ContentProfileRef.safeParse(taskFrameFrom(previousTurn?.taskFrame).contentProfile);
      // Explicit material actions reuse a known profile; new scope is classified in the existing planning step.
      const goals: TaskFrameGoal[] = [];
      if (input.action === 'generate_lesson') {
        goals.push({ type: 'lesson', source: 'student_request', target: input.text?.slice(0, 200) ?? '按已确认范围生成讲义' });
      }
      if (input.action === 'generate_practice') {
        goals.push({ type: 'practice', source: 'student_request', count: 2 });
      }
      const taskFrame: TaskFrame = source ? { ...taskFrameFrom(source.taskFrame), goals: taskFrameFrom(source.taskFrame).goals.map(({ failure, startedJobId, ...goal }) => goal), historyCount: history.length } : {
        readback: input.artifactId || input.attemptId ? undefined : initialReadback(input.text ?? '', userMessage.id),
        planned: !subject?.confirmedAt || (Boolean(input.action) && previousProfile.success && previousProfile.data.id === 'math'),
        contentProfile: subject?.confirmedAt && input.action && previousProfile.success && previousProfile.data.id === 'math' ? previousProfile.data : undefined,
        solutionRequested: input.action === 'show_solution',
        historyCount: history.length,
        kind: input.action === 'show_solution' ? 'solution' : goals.length > 0 ? 'material' : 'chat',
        action: input.action,
        practiceMode: input.practiceMode,
        focus: {
          artifactId: input.artifactId,
          artifactVersion: input.artifactVersion,
          sectionId: input.sectionId,
          attemptId: input.attemptId,
          exerciseId: input.exerciseId,
        },
        goals,
      };

      const run = await tx.agentRun.create({
        data: {
          conversationId,
          subjectId: object.id,
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
      await tx.conversation.update({ where: { id: conversationId }, data: { lastActiveAt: new Date(), archivedAt: null } });
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
