import { db } from '../lib/db';
import { withActiveRun, RunStoppedError } from './run-guard';
import { env } from '../lib/env';
import { spendToolExecution, type RunCounters } from './limits';
import type { TurnPolicy } from './policy';
import { findToolDefinition } from './tools';
import { taskFrameFrom, type PendingBatch } from './types';
import { textOf } from './blocks';
import { LessonSource } from '../jobs/lesson-revision';
import { evidencePack } from './teaching-memory';
import { readHistory, type MessageReadOptions } from './history-reader';

/**
 * 工具执行器（设计文档 §4.12 / §6.1）。
 * 顺序：查注册表 → 权限校验 → 参数 schema → 幂等读取原结果 → 扣预算 → 执行 → 结构化结果。
 * 校验失败作为该工具调用的 error 结果返回模型；进程崩溃标记中断。
 */

export type ToolOutcome =
  | { kind: 'result'; value: unknown }
  | { kind: 'error'; code: string; retryable: boolean; message: string }
  | { kind: 'deferred'; jobId: string; artifactId: string | null; artifactType: string };

export interface BatchExecutionContext {
  userId: string;
  conversationId: string;
  runId: string;
  leaseOwner: string;
  policy: TurnPolicy;
  counters: RunCounters;
}

/** 执行一个批次；遇到长工具返回 waiting（保存剩余项，恢复后继续，§4.12） */
export async function executeBatch(
  ctx: BatchExecutionContext,
  batch: PendingBatch,
): Promise<
  | { kind: 'waiting'; jobIds: string[]; jobs: Array<{ toolCallId: string; jobId: string; artifactId: string | null; artifactType: string }> }
  | { kind: 'results'; results: Array<{ toolCallId: string; toolName: string; value: unknown }> }
> {
  const jobIds: string[] = [];
  const jobsInfo: Array<{ toolCallId: string; jobId: string; artifactId: string | null; artifactType: string }> = [];
  const results: Array<{ toolCallId: string; toolName: string; value: unknown }> = [];

  for (const item of batch.items) {
    const outcome = await executeOne(ctx, batch.decisionId, item.toolCallId, item.toolName, item.input);
    if (outcome.kind === 'deferred') {
      jobIds.push(outcome.jobId);
      jobsInfo.push({ toolCallId: item.toolCallId, jobId: outcome.jobId, artifactId: outcome.artifactId, artifactType: outcome.artifactType });
      continue;
    }
    results.push({
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      value:
        outcome.kind === 'result'
          ? outcome.value
          : { ok: false, code: outcome.code, message: outcome.message, retryable: outcome.retryable },
    });
  }

  if (jobIds.length > 0) return { kind: 'waiting', jobIds, jobs: jobsInfo };
  return { kind: 'results', results };
}

async function executeOne(
  ctx: BatchExecutionContext,
  decisionId: string,
  toolCallId: string,
  toolName: string,
  input: unknown,
): Promise<ToolOutcome> {
  const started = Date.now();
  const def = findToolDefinition(toolName);
  if (!def) {
    await markExecution(ctx.runId, toolCallId, 'failed', { code: 'UNKNOWN_TOOL', message: `未知工具 ${toolName}`, retryable: false });
    return { kind: 'error', code: 'UNKNOWN_TOOL', retryable: false, message: `未知工具 ${toolName}` };
  }

  // 已完成的同一调用读取原结果，不再产生副作用（§4.12）
  const row = await db.toolExecution.findUnique({
    where: { runId_toolCallId: { runId: ctx.runId, toolCallId } },
  });
  if (row) {
    if (row.status === 'succeeded' && row.resultRef) {
      return { kind: 'result', value: row.resultRef };
    }
    if (row.status === 'failed' && row.error) {
      const e = row.error as { code: string; retryable: boolean; message: string };
      return { kind: 'error', ...e };
    }
    if (row.status === 'deferred' && row.jobId) {
      const settled = await checkDeferredJob(row.jobId, toolName);
      if (settled) {
        if (settled.kind === 'result') await markExecution(ctx.runId, toolCallId, 'succeeded', undefined, settled.value);
        else if (settled.kind === 'error') await markExecution(ctx.runId, toolCallId, 'failed', { code: settled.code, message: settled.message, retryable: settled.retryable });
        return settled;
      }
      return {
        kind: 'deferred',
        jobId: row.jobId,
        artifactId: null,
        artifactType: toolName === 'createLesson' ? 'lesson' : 'exercise_set',
      };
    }
  }

  if (!ctx.policy.allowedTools.includes(toolName)) {
    // 权限失败不重复尝试（§6.1）
    const error = { code: 'FORBIDDEN', retryable: false, message: `当前状态不允许使用 ${toolName}` };
    await markExecution(ctx.runId, toolCallId, 'failed', error);
    return { kind: 'error', ...error };
  }

  const parsed = def.inputSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    const error = { code: 'INVALID_INPUT', retryable: true, message: `工具参数不合法：${detail}` };
    await markExecution(ctx.runId, toolCallId, 'failed', error);
    return { kind: 'error', ...error };
  }

  if (!spendToolExecution(ctx.counters)) {
    const error = { code: 'LIMIT', retryable: false, message: '工具执行次数已达保护上限' };
    await markExecution(ctx.runId, toolCallId, 'failed', error);
    return { kind: 'error', ...error };
  }

  try {
    let outcome: ToolOutcome;
    if (toolName === 'readLearningContext') {
      outcome = { kind: 'result', value: await readLearningContext(ctx, parsed.data as ReadContextInput) };
    } else if (toolName === 'recognizeMaterial') {
      // 上传链路（第二周接入）：返回可恢复错误供模型向学生说明
      outcome = {
        kind: 'error',
        code: 'NOT_AVAILABLE',
        retryable: false,
        message: '图片上传链路尚未接入，无法读取图片；请学生用文字描述题目',
      };
    } else if (toolName === 'createLesson' || toolName === 'createPractice') {
      outcome = await createMaterialJob(ctx, toolName, parsed.data as Record<string, unknown>);
    } else {
      outcome = { kind: 'error', code: 'UNKNOWN_TOOL', retryable: false, message: `工具未实现：${toolName}` };
    }

    if (outcome.kind === 'result') {
      await markExecution(ctx.runId, toolCallId, 'succeeded', undefined, outcome.value, Date.now() - started);
    } else if (outcome.kind === 'error') {
      await markExecution(ctx.runId, toolCallId, 'failed', { code: outcome.code, message: outcome.message, retryable: outcome.retryable }, undefined, Date.now() - started);
    } else {
      // 材料入口的"生成中"由任务状态表达；发布时由 publishArtifact 原子建 Artifact（§8.4）
      await db.toolExecution.updateMany({
        where: { runId: ctx.runId, toolCallId },
        data: { status: 'deferred', jobId: outcome.jobId, resultRef: { jobId: outcome.jobId }, durationMs: Date.now() - started },
      });
    }
    return outcome;
  } catch (err) {
    if (err instanceof RunStoppedError) throw err;
    const error = { code: 'TOOL_ERROR', retryable: true, message: err instanceof Error ? err.message : '工具执行异常' };
    await markExecution(ctx.runId, toolCallId, 'failed', error);
    return { kind: 'error', ...error };
  }
}

async function markExecution(
  runId: string,
  toolCallId: string,
  status: string,
  error?: { code: string; message: string; retryable: boolean },
  resultRef?: unknown,
  durationMs?: number,
): Promise<void> {
  await db.toolExecution.updateMany({
    where: { runId, toolCallId },
    data: {
      status,
      ...(error ? { error } : {}),
      ...(resultRef !== undefined ? { resultRef: resultRef as object } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
  });
}

interface ReadContextInput extends Partial<MessageReadOptions> {
  ref: 'subject' | 'artifacts' | 'attempt' | 'messages';
  attemptId?: string;
  sectionId?: string;
  artifactId?: string;
  beforeMessageId?: string;
  messageIds?: string[];
  limit?: number;
}

export async function readLearningContext(ctx: Pick<BatchExecutionContext, 'userId' | 'conversationId' | 'policy'> & { runId?: string }, input: ReadContextInput): Promise<unknown> {
  if (!await db.conversation.findFirst({ where: { id: ctx.conversationId, userId: ctx.userId }, select: { id: true } })) return { ok: false, code: 'NOT_FOUND', message: '学习会话不存在' };
  if (input.ref === 'subject') {
    const subject = await db.subjectRevision.findFirst({
      where: { id: ctx.policy.subjectRevisionId ?? '', conversationId: ctx.conversationId, subjectId: ctx.policy.subjectId },
      orderBy: { version: 'desc' },
    });
    return {
      ok: true,
      subject: subject
        ? {
            id: subject.id,
            version: subject.version,
            type: subject.type,
            text: (subject.content as { text?: string }).text ?? '',
            tags: subject.tags,
            confirmed: Boolean(subject.confirmedAt),
          }
        : null,
    };
  }
  if (input.ref === 'artifacts') {
    const artifactId = input.artifactId ?? ctx.policy.focus.artifactId;
    if (artifactId || input.sectionId) {
      if (!artifactId) return { ok: false, code: 'INVALID_INPUT', message: '读取段落需提供当前材料' };
      const artifact = await db.artifact.findFirst({
        where: { id: artifactId, conversationId: ctx.conversationId, subjectRevisionId: ctx.policy.subjectRevisionId ?? '', type: 'lesson', publishStatus: 'published' },
      });
      if (!artifact) return { ok: false, code: 'NOT_FOUND', message: '当前会话中没有该讲义' };
      const lesson = (artifact.content as { lesson?: { title: string; sections: Array<{ id: string }>; diagrams?: Array<{ sectionId: string; content: unknown }> } }).lesson;
      if (artifactId === ctx.policy.focus.artifactId && ctx.policy.focus.sectionId && input.sectionId && input.sectionId !== ctx.policy.focus.sectionId) return { ok: false, code: 'INVALID_INPUT', message: '只能读取本轮指定段落' };
      const sectionId = input.sectionId ?? (artifactId === ctx.policy.focus.artifactId ? ctx.policy.focus.sectionId : undefined);
      const sections = sectionId ? lesson?.sections.filter((section) => section.id === sectionId) : lesson?.sections;
      if (sectionId && !sections?.length) return { ok: false, code: 'NOT_FOUND', message: '讲义段落不存在' };
      // A hint-only turn must not regain a previous solution-bearing lesson through historical reads.
      const sourceJob = artifact.jobId ? await db.generationJob.findUnique({ where: { id: artifact.jobId } }) : null;
      if ((sourceJob?.payload as { answerPermission?: boolean } | null)?.answerPermission && !ctx.policy.allowSolution) return { ok: false, code: 'FORBIDDEN', message: '该讲义包含完整解析，本轮尚未授权' };
      return { ok: true, artifactId, version: artifact.version, lesson: { title: lesson?.title, sections,
        diagrams: lesson?.diagrams?.filter((d) => !sectionId || d.sectionId === sectionId) ?? [] } };
    }
    const artifacts = await db.artifact.findMany({
      where: { conversationId: ctx.conversationId, subjectRevisionId: ctx.policy.subjectRevisionId ?? '', publishStatus: 'published' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { id: true, type: true, version: true, publishStatus: true, subjectRevisionId: true },
    });
    return { ok: true, artifacts };
  }
  if (input.ref === 'attempt') {
    if (!input.attemptId || input.attemptId !== ctx.policy.focus.attemptId) return { ok: false, code: 'INVALID_INPUT', message: '缺少 attemptId' };
    // 答案侧不加载（answerPermission 默认否，§4.6）：只给题干、进度与本人作答
    const attempt = await db.practiceAttempt.findFirst({
      where: { id: input.attemptId, userId: ctx.userId, artifact: { conversationId: ctx.conversationId, subjectRevisionId: ctx.policy.subjectRevisionId ?? '' } },
      include: { artifact: { include: { exercises: { orderBy: { order: 'asc' } } } }, answers: true },
    });
    if (!attempt) return { ok: false, code: 'NOT_FOUND', message: '练习轮次不存在' };
    const ids = (attempt.exerciseIds as string[]).filter((id) => id === ctx.policy.focus.exerciseId);
    if (!ids.length) return { ok: false, code: 'INVALID_INPUT', message: '请明确要追问的当前练习题' };
    if (ctx.policy.answerPermission) {
      await db.practiceAnswer.upsert({ where: { attemptId_exerciseId: { attemptId: attempt.id, exerciseId: ids[0]! } },
        create: { attemptId: attempt.id, exerciseId: ids[0]!, solutionViewedAt: new Date() }, update: { solutionViewedAt: new Date() } });
    }
    return {
      ok: true,
      attempt: {
        id: attempt.id,
        stage: attempt.stage,
        exercises: attempt.artifact.exercises
          .filter((ex) => ids.includes(ex.id))
          .map((ex) => ({ id: ex.id, order: ex.order, stem: ex.stem, topic: ex.topic, difficulty: ex.difficulty,
            ...(ctx.policy.answerPermission ? { answer: ex.answer, analysis: ex.analysis } : {}) })),
        answers: attempt.answers.filter((a) => ids.includes(a.exerciseId)).map((a) => ({
          exerciseId: a.exerciseId,
          textDraft: a.textDraft,
          markedUnknown: a.markedUnknown,
          hintsUsed: a.hintsUsed,
        })),
      },
    };
  }
  return readHistory(ctx, input);
}

/** createLesson/createPractice：原子创建任务与输入快照，返回 deferred（§6.1） */
async function createMaterialJob(
  ctx: BatchExecutionContext,
  toolName: 'createLesson' | 'createPractice',
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (!ctx.policy.subjectConfirmed || !ctx.policy.subjectRevisionId) {
    return {
      kind: 'error',
      code: 'SUBJECT_UNCONFIRMED',
      retryable: false,
      message: '学习对象尚未确认，不能生成讲义或练习；先请学生核对确认',
    };
  }

  // 幂等：同一工具执行只产生一个任务；明确的重新生成走新执行记录，天然是新任务（§4.12）
  const goalType = toolName === 'createLesson' ? 'lesson' : 'practice';
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: ctx.runId } });
  const frame = taskFrameFrom(run.taskFrame);
  if (frame.conditionCorrection || frame.readback?.status === 'pending') return { kind: 'error', code: 'EVIDENCE_REQUIRED', message: '先回读历史依据或澄清/确认更正条件，再生成材料', retryable: false };
  const goal = frame.goals.find((g) => g.type === goalType);
  if (!goal) return { kind: 'error', code: 'NOT_REQUESTED', message: '学生本轮未请求这种材料，不得擅自扩充目标', retryable: false };
  if (goal.completedArtifactId) return { kind: 'result', value: { ok: true, artifactId: goal.completedArtifactId, type: toolName === 'createLesson' ? 'lesson' : 'exercise_set', status: 'published' } };
  const key = `run:${ctx.runId}:goal:${goalType}`;
  const existing = await db.generationJob.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    return { kind: 'deferred', jobId: existing.id, artifactId: existing.resultArtifactId, artifactType: toolName === 'createLesson' ? 'lesson' : 'exercise_set' };
  }

  const subject = await db.subjectRevision.findUnique({ where: { id: ctx.policy.subjectRevisionId } });
  const type = toolName === 'createLesson' ? 'lesson' : 'exercise_set';
  let sourceLesson: LessonSource | undefined;
  if (toolName === 'createLesson' && (ctx.policy.focus.sectionId || input.sectionRef)) {
    const sectionId = ctx.policy.focus.sectionId ?? String(input.sectionRef);
    if (input.sectionRef && input.sectionRef !== sectionId) return { kind: 'error', code: 'INVALID_INPUT', retryable: false, message: '修订段落与学生选择不一致' };
    const artifact = await db.artifact.findFirst({ where: { id: ctx.policy.focus.artifactId ?? '', conversationId: ctx.conversationId,
      subjectRevisionId: subject!.id, type: 'lesson', publishStatus: 'published' } });
    if (!artifact || (ctx.policy.focus.artifactVersion && ctx.policy.focus.artifactVersion !== artifact.version)) return { kind: 'error', code: 'INVALID_INPUT', retryable: false, message: '请从有效讲义选择要修改的段落' };
    const sourceJob = artifact.jobId ? await db.generationJob.findUnique({ where: { id: artifact.jobId } }) : null;
    if ((sourceJob?.payload as { answerPermission?: boolean } | null)?.answerPermission && !ctx.policy.allowSolution) return { kind: 'error', code: 'FORBIDDEN', retryable: false, message: '本轮未授权重讲完整解析' };
    sourceLesson = LessonSource.parse({ artifactId: artifact.id, artifactVersion: artifact.version, sectionId, lesson: (artifact.content as { lesson?: unknown }).lesson });
    if (!sourceLesson.lesson.sections.some((s) => s.id === sectionId)) return { kind: 'error', code: 'INVALID_INPUT', retryable: false, message: '原段落不存在' };
  }
  const payload = {
    type,
    subjectRevisionId: subject!.id,
    subjectText: (subject!.content as { text?: string }).text ?? '',
    tags: subject!.tags,
    // 任务参数创建时固定（§6.1），worker 不从可变状态重建
    ...(toolName === 'createLesson' ? { target: String(input.target ?? '') , sectionRef: input.sectionRef } : { count: input.count ?? 2, difficulty: input.difficulty }),
    answerPermission: ctx.policy.allowSolution,
    teachingMode: ctx.policy.teachingMode ?? 'question',
    evidence: await evidencePack(ctx),
    ...(sourceLesson ? { sourceLesson } : {}),
  };

  const job = await withActiveRun(ctx.runId, ctx.leaseOwner, (tx) => tx.generationJob.create({
    data: {
      type,
      conversationId: ctx.conversationId,
      subjectId: ctx.policy.subjectId,
      subjectRevisionId: subject!.id,
      runId: ctx.runId,
      status: 'queued',
      idempotencyKey: key,
      payload: payload as object,
      deadlineAt: new Date(Date.now() + env().JOB_TOTAL_MS),
    },
  }));
  // 不预建 Artifact：发布由 worker 的 publishArtifact 在事务内完成（§8.4）
  return { kind: 'deferred', jobId: job.id, artifactId: null, artifactType: type };
}

/** deferred 任务终态检查：worker 完成后补回真实结果（§4.13） */
async function checkDeferredJob(jobId: string, toolName: string): Promise<ToolOutcome | null> {
  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  if (!job) return { kind: 'error', code: 'JOB_LOST', retryable: false, message: '任务记录丢失' };
  if (job.status === 'succeeded' && job.resultArtifactId) {
    const artifact = await db.artifact.findUnique({ where: { id: job.resultArtifactId } });
    return {
      kind: 'result',
      value: { ok: true, artifactId: job.resultArtifactId, status: artifact?.publishStatus ?? 'published', type: toolName === 'createLesson' ? 'lesson' : 'exercise_set' },
    };
  }
  if (job.status === 'failed') {
    const e = job.error as { code?: string; message?: string; retryable?: boolean } | null;
    return { kind: 'error', code: e?.code ?? 'JOB_FAILED', retryable: e?.retryable ?? true, message: e?.message ?? '材料生成失败' };
  }
  if (job.status === 'cancelled' || job.status === 'superseded') {
    return { kind: 'error', code: job.status.toUpperCase(), retryable: false, message: `任务已${job.status === 'cancelled' ? '取消' : '因题目更新被替换'}` };
  }
  return null; // 仍在排队/执行
}
