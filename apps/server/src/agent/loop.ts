import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { activeControllers, RunStoppedError, withActiveRun } from './run-guard';
import type { StreamEvent } from '@luma/shared';
import { aggregateJobUsage } from '../lib/model-accounting';
import { db } from '../lib/db';
import { env } from '../lib/env';
import type { EventEmitter } from '../lib/sse';
import { nextAgentStep, type AgentStep, type ModelMessage, type ToolCall } from '../lib/model';
import { assembleSystem, learningData, budgetContext, ContextBudgetError } from './context';
import {
  clearFailure,
  recordFailure,
  modelBudgetAvailable,
  correctionAllowed,
  countersFrom,
  initialCounters,
  recordCorrection,
  recordModelRequest,
  recordUsage,
  spendDecision,
  spendToolRound,
  type RunCounters,
} from './limits';
import { mockClarify, mockGuide, mockSolution } from './mock';
import { buildPolicy } from './policy';
import { assistantToolCallsMessage, correctionMessage, toolResultsMessage } from './protocol';
import { executeBatch } from './tool-executor';
import { nativeToolSet } from './tools';
import { taskFrameFrom, type PendingBatch, type TaskFrame } from './types';

/**
 * 驱动器（设计文档 §4.12）：唯一的循环所有者。
 * 领取租约 → 恢复点先完成工具批次 → 决策 → respond 校验提交 / 工具批次保存 → 停靠或继续。
 * 状态、协议、计数全部落库；进程崩溃后由租约过期重新领取，不精确续跑。
 */


const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export async function drive(runId: string, emit?: EventEmitter, signal?: AbortSignal): Promise<void> {
  const owner = `drive-${randomUUID()}`;
  // 原子领取会话执行权与运行租约；抢不到即退出（§4.12 claim）
  const claimed = await db.agentRun.updateMany({
    where: {
      id: runId,
      status: { in: ['running', 'waiting_job'] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { status: 'running', leaseBy: owner, leaseUntil: new Date(Date.now() + env().RUN_LEASE_MS) },
  });
  if (claimed.count === 0) return;

  const controller = new AbortController();
  activeControllers.set(runId, controller);
  const onDisconnect = () => controller.abort(new Error('客户端已停止接收'));
  signal?.addEventListener('abort', onDisconnect, { once: true });
  if (signal?.aborted) onDisconnect();
  let checking = false;
  const heartbeat = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const current = await db.agentRun.findUnique({ where: { id: runId } });
      if (!current || current.status !== 'running' || current.leaseBy !== owner ||
        (current.deadlineAt && current.deadlineAt.getTime() <= Date.now())) {
        controller.abort(new Error('运行已停止或超时'));
        return;
      }
      const renewed = await db.agentRun.updateMany({
        where: { id: runId, status: 'running', leaseBy: owner, leaseUntil: { gt: new Date() } },
        data: { leaseUntil: new Date(Date.now() + env().RUN_LEASE_MS) },
      });
      if (renewed.count !== 1) controller.abort(new Error('执行租约失效'));
    } catch (err) {
      controller.abort(err);
    } finally { checking = false; }
  }, Math.min(1000, Math.max(20, Math.floor(env().RUN_LEASE_MS / 3))));
  let partialText = '';
  let partialMessageId: string | undefined;
  let savedAt = 0, savedLength = 0;
  async function savePartial(text: string) {
    await withActiveRun(runId, owner, async (tx) => {
      if (partialMessageId) await tx.message.update({ where: { id: partialMessageId }, data: { content: { blocks: [{ type: 'text', text }] } } });
      else {
        const run = await tx.agentRun.findUniqueOrThrow({ where: { id: runId } });
        const row = await tx.message.create({ data: { conversationId: run.conversationId, subjectId: run.subjectId,
          subjectRevisionId: run.subjectRevisionId, runId, role: 'assistant', status: 'incomplete', content: { blocks: [{ type: 'text', text }] } } });
        partialMessageId = row.id;
      }
    });
    savedAt = Date.now(); savedLength = text.length;
  }
  async function resetPartial() {
    if (partialMessageId) await withActiveRun(runId, owner, (tx) => tx.message.deleteMany({ where: { id: partialMessageId, status: 'incomplete' } }));
    if (partialText) emit?.({ type: 'text.reset', runId });
    partialText = ''; partialMessageId = undefined; savedLength = 0;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const initial = await db.agentRun.findUnique({ where: { id: runId } });
    timeout = setTimeout(() => controller.abort(new Error('本轮运行超时')),
      Math.max(1, (initial?.deadlineAt?.getTime() ?? Date.now() + env().TURN_TOTAL_MS) - Date.now()));
    for (; ;) {
      controller.signal.throwIfAborted();
      const run = await db.agentRun.findUnique({ where: { id: runId } });
      if (!run || !['running', 'waiting_job'].includes(run.status) || run.leaseBy !== owner) return;
      // assertActive：取消、时限、预算（取消由状态条件检查实现）
      if (run.deadlineAt && run.deadlineAt.getTime() < Date.now()) {
        await failRun(runId, 'LIMIT', '本轮运行超时，可重试', true, emit, owner);
        return;
      }
      await db.agentRun.updateMany({
        where: { id: runId, leaseBy: owner },
        data: { leaseUntil: new Date(Date.now() + env().RUN_LEASE_MS) },
      });

      const counters = countersFrom(run.counters);
      counters.background = aggregateJobUsage(await db.generationJob.findMany({ where: { runId }, select: { counters: true } }));
      const protocol = ((run.protocol ?? []) as ModelMessage[]).slice();
      const taskFrame = taskFrameFrom(run.taskFrame);
      const conversation = await db.conversation.findUnique({
        where: { id: run.conversationId },
        select: { userId: true },
      });
      if (!conversation) {
        await failRun(runId, 'INTERNAL', '会话不存在', false, emit, owner);
        return;
      }
      const policy = await buildPolicy({
        conversationId: run.conversationId,
        subjectId: run.subjectId,
        action: taskFrame.action,
        solutionRequested: taskFrame.solutionRequested,
        focus: taskFrame.focus,
      });

      // 恢复点：先完成已有工具批次，不能重发模型请求跳过旧结果（§4.12）
      if (run.pendingBatch) {
        const batch = run.pendingBatch as unknown as PendingBatch;
        const outcome = await executeBatch(
          { userId: conversation.userId, conversationId: run.conversationId, runId, leaseOwner: owner, policy, counters },
          batch,
        );

        if (outcome.kind === 'waiting') {
          // 长工具进入 waiting_job：释放前台连接，不保持模型空转（§4.5）
          markGoalsStarted(taskFrame, outcome.jobs);
          await withActiveRun(runId, owner, async (tx) => tx.agentRun.update({
            where: { id: runId },
            data: {
              status: 'waiting_job', waitingJobIds: outcome.jobIds, taskFrame: asJson(taskFrame),
              counters: asJson(counters), leaseBy: null, leaseUntil: null
            },
          }));
          for (const job of outcome.jobs) {
            if (job.artifactId) {
              emit?.({ type: 'artifact.updated', runId, subjectId: run.subjectId, subjectRevisionId: run.subjectRevisionId!, artifactId: job.artifactId, artifactType: job.artifactType as 'lesson' | 'exercise_set', status: 'generating' });
            }
            emit?.({ type: 'job.created', runId, jobId: job.jobId, artifactId: job.artifactId, artifactType: (job.artifactType as 'lesson' | 'exercise_set') ?? null });
          }
          emit?.({ type: 'run.waiting', runId, waiting: 'job', jobIds: outcome.jobIds });
          return; // 不保持调用栈或模型连接
        }

        // 全部结果就绪：按 toolCallId 补回结果，才允许下一次决策（§4.13）
        protocol.push(toolResultsMessage(outcome.results));
        mergeGoalCompletions(taskFrame, outcome.results);
        for (const r of outcome.results) {
          const value = r.value as { ok?: boolean; code?: string };
          if (value?.ok === false) {
            const input = batch.items.find((item) => item.toolCallId === r.toolCallId)?.input;
            const key = createHash('sha256').update(JSON.stringify([r.toolName, input, value.code])).digest('hex');
            if (recordFailure(counters, key)) {
              await withActiveRun(runId, owner, (tx) => tx.agentRun.update({ where: { id: runId }, data: { counters: asJson(counters) } }));
              await failRun(runId, 'NO_PROGRESS', '相同工具连续失败，已停止自动尝试，请调整输入后重试', false, emit, owner); return;
            }
          } else clearFailure(counters);
        }
        await withActiveRun(runId, owner, (tx) => tx.agentRun.update({
          where: { id: runId },
          data: {
            pendingBatch: Prisma.DbNull,
            waitingJobIds: [],
            protocol: asJson(protocol),
            taskFrame: asJson(taskFrame),
            counters: asJson(counters),
          },
        }));
        for (const r of outcome.results) {
          const value = r.value as { ok?: boolean };
          emit?.({ type: 'tool.finished', runId, toolExecutionId: r.toolCallId, ok: value?.ok !== false });
        }
        continue;
      }

      if (run.status === 'waiting_job') {
        // 等待态但没有 pendingBatch：状态不一致，交还调度器
        await db.agentRun.updateMany({
          where: { id: runId, leaseBy: owner },
          data: { status: 'waiting_job', leaseBy: null, leaseUntil: null },
        });
        return;
      }

      // ---- 决策步骤 ----
      if (!spendDecision(counters)) {
        await failRun(runId, 'LIMIT', '本轮决策步数已达保护上限', false, emit, owner);
        return;
      }
      const planning = !taskFrame.planned;
      const tools = nativeToolSet(planning);
      const system = await assembleSystem(policy, taskFrame);
      const context = budgetContext({ system, facts: await learningData(policy, conversation.userId, run.conversationId, taskFrame), protocol, historyCount: taskFrame.historyCount ?? 0, tools });
      if (!modelBudgetAvailable(counters)) {
        await failRun(runId, 'LIMIT', '本轮模型请求或累计用量已达保护上限', false, emit, owner); return;
      }
      recordModelRequest(counters, 'agent');
      // Reserve before network calls; a process failure cannot erase an attempted request.
      await withActiveRun(runId, owner, (tx) => tx.agentRun.update({ where: { id: runId }, data: {
        counters: asJson(counters), policySnapshot: asJson({ ...policy, estimatedInputTokens: context.estimatedInputTokens, omittedHistory: context.omittedHistory }),
      } }));
      const started = Date.now();
      const subjectText = await loadSubjectText(policy.subjectRevisionId);
      const step = await nextAgentStep({
        purpose: 'agent', system, messages: context.messages, tools,
        abortSignal: AbortSignal.any([controller.signal, AbortSignal.timeout(env().MODEL_REQUEST_MS)]),
        mock: planning ? { kind: 'plan', plan: { goals: [], solutionRequested: false }, calls: [{ toolCallId: `plan_${randomUUID()}`, toolName: 'planTurn', input: { goals: [], solutionRequested: false } }] } : mockStep(policy, taskFrame, subjectText),
        onText: async (delta) => {
          controller.signal.throwIfAborted(); partialText += delta;
          if (emit) {
            if (!partialMessageId || Date.now() - savedAt > 600 || partialText.length - savedLength > 300) await savePartial(partialText);
            emit({ type: 'text.delta', runId, delta });
          }
        },
        onReset: resetPartial,
      });
      recordUsage(counters, step.usage);
      counters.calls.push({ purpose: 'agent', model: env().LUMA_MOCK_AGENT ? 'mock' : env().LUMA_MODEL_ID,
        attempt: counters.modelRequests.agent!, durationMs: Date.now() - started,
        inputTokens: step.usage?.inputTokens ?? null, outputTokens: step.usage?.outputTokens ?? null,
        ...(step.kind === 'issue' ? { error: step.code } : {}) });
      await withActiveRun(runId, owner, (tx) => tx.agentRun.update({ where: { id: runId }, data: { counters: asJson(counters) } }));
      controller.signal.throwIfAborted();

      if (step.kind === 'plan') {
        if (!planning) { await failRun(runId, 'PROTOCOL', '本轮目标已记录，不能重复规划', false, emit, owner); return; }
        const goals = policy.subjectConfirmed ? [...new Map(step.plan.goals.map((goal) => [goal.type, goal])).values()] : [];
        taskFrame.planned = true; taskFrame.goals = goals;
        taskFrame.solutionRequested = policy.subjectConfirmed && step.plan.solutionRequested;
        taskFrame.kind = goals.length ? 'material' : taskFrame.solutionRequested ? 'solution' : 'chat';
        protocol.push(assistantToolCallsMessage(step.calls), toolResultsMessage([{ toolCallId: step.calls[0]!.toolCallId, toolName: 'planTurn',
          value: { ok: true, goals, solutionRequested: taskFrame.solutionRequested } }]));
        await withActiveRun(runId, owner, async (tx) => {
          await tx.toolExecution.create({ data: { runId, decisionId: `${runId}:d${counters.decisions}`, toolCallId: step.calls[0]!.toolCallId,
            tool: 'planTurn', batchOrder: 0, status: 'succeeded', resultRef: asJson({ goals, solutionRequested: taskFrame.solutionRequested }), durationMs: Date.now() - started } });
          await tx.agentRun.update({ where: { id: runId }, data: { taskFrame: asJson(taskFrame), protocol: asJson(protocol) } });
        });
        continue;
      }
      if (planning) { await resetPartial(); await failRun(runId, 'PROTOCOL', '目标决策未完成，请重试', true, emit, owner); return; }

      if (step.kind === 'respond') {
        const validation = await validateRespond(step.disposition, taskFrame);
        if (!validation.ok) {
          // finish 条件不满足：协议校正，有限次（§4.11）
          await resetPartial();
          if (correctionAllowed(counters)) {
            recordCorrection(counters);
            protocol.push(correctionMessage(validation.message));
            await withActiveRun(runId, owner, (tx) => tx.agentRun.update({
              where: { id: runId },
              data: { protocol: asJson(protocol), counters: asJson(counters) },
            }));
            continue;
          }
          await failRun(runId, 'PROTOCOL', validation.message, true, emit, owner);
          return;
        }

        // 学生可见正文来自 respond.text（§4.11）；结构化成果引用随消息保存
        const blocks: unknown[] = [{ type: 'text', text: step.text }];
        for (const goal of taskFrame.goals) {
          if (goal.completedArtifactId) {
            blocks.push({ type: 'artifact', artifactId: goal.completedArtifactId, artifactType: goal.type === 'lesson' ? 'lesson' : 'exercise_set', status: 'published' });
          }
        }
        if (!policy.subjectConfirmed && policy.subjectRevisionId) {
          const subject = await db.subjectRevision.findUnique({ where: { id: policy.subjectRevisionId } });
          if (subject) {
            blocks.push({ type: 'clarification', subjectRevisionId: subject.id, version: subject.version, text: step.text, tags: subject.tags });
          }
        }

        const nextStatus = step.disposition === 'finish' ? 'completed' : 'waiting_user';
        await withActiveRun(runId, owner, async (tx) => {
          const data = { content: { blocks, focus: taskFrame.focus ?? {} } as Prisma.InputJsonValue, status: 'complete' as const };
          if (partialMessageId) await tx.message.update({ where: { id: partialMessageId }, data });
          else await tx.message.create({ data: { conversationId: run.conversationId, subjectId: run.subjectId, role: 'assistant',
            runId, subjectRevisionId: run.subjectRevisionId, ...data } });
          await updateStage(tx, run.conversationId, policy, taskFrame);
          await tx.agentRun.update({
            where: { id: runId },
            data: {
              status: nextStatus, finishedAt: new Date(), counters: asJson(counters),
              usage: step.usage ? asJson(step.usage) : undefined, pendingBatch: Prisma.DbNull, waitingJobIds: []
            },
          });
          await tx.conversation.update({ where: { id: run.conversationId }, data: { lastActiveAt: new Date() } });
        });
        if (!partialText) emit?.({ type: 'text.delta', runId, delta: step.text });
        partialText = ''; partialMessageId = undefined;
        if (nextStatus === 'completed') {
          emit?.({ type: 'run.completed', runId, stage: policy.stage });
        } else {
          emit?.({ type: 'run.waiting', runId, waiting: 'user', jobIds: [] });
        }
        return;
      }

      if (step.kind === 'tool_calls') {
        if (!spendToolRound(counters)) {
          await failRun(runId, 'LIMIT', '工具往返次数已达保护上限', false, emit, owner);
          return;
        }
        const decisionId = `${runId}:d${counters.decisions}`;
        // 先保存 assistant 工具调用消息与批次，再产生业务副作用（§4.12）
        protocol.push(assistantToolCallsMessage(step.calls));
        const items: PendingBatch['items'] = step.calls.map((c: ToolCall) => ({ toolCallId: c.toolCallId, toolName: c.toolName, input: c.input }));
        await withActiveRun(runId, owner, async (tx) => {
          for (const [idx, item] of items.entries()) {
            await tx.toolExecution.create({
              data: {
                runId,
                decisionId,
                toolCallId: item.toolCallId,
                tool: item.toolName,
                batchOrder: idx,
                status: 'pending',
                idempotencyKey: `${runId}:${decisionId}:${item.toolCallId}`,
                paramsDigest: { input: item.input } as Prisma.InputJsonValue,
              },
            });
          }
          await tx.agentRun.update({
            where: { id: runId },
            data: { pendingBatch: asJson({ decisionId, items } satisfies PendingBatch), protocol: asJson(protocol), counters: asJson(counters) },
          });
        });
        for (const item of items) {
          emit?.({ type: 'tool.started', runId, toolExecutionId: item.toolCallId, tool: item.toolName });
        }
        continue;
      }

      if (step.kind === 'issue' && !step.code.startsWith('PROTOCOL')) {
        await failRun(runId, step.code, step.message, step.retryable, emit, owner); return;
      }
      // issue：有限校正，不可恢复则失败终止（§4.12 handleModelIssue）
      if (correctionAllowed(counters)) {
        recordCorrection(counters);
        protocol.push(correctionMessage(step.message));
        await withActiveRun(runId, owner, (tx) => tx.agentRun.update({
          where: { id: runId },
          data: { protocol: asJson(protocol), counters: asJson(counters) },
        }));
        continue;
      }
      await failRun(runId, step.code, step.message, step.retryable, emit, owner);
      return;
    }
  } catch (err) {
    if (err instanceof ContextBudgetError) {
      await failRun(runId, 'CONTEXT_LIMIT', err.message, false, emit, owner);
    } else if (signal?.aborted) {
      const stopped = await db.agentRun.updateMany({
        where: { id: runId, status: 'running', leaseBy: owner },
        data: { status: 'cancelled', finishedAt: new Date() },
      });
      if (stopped.count) emit?.({ type: 'run.cancelled', runId });
    } else if (err instanceof RunStoppedError) {
      await failRun(runId, 'RUN_INTERRUPTED', err.message, true, emit, owner);
    } else {
      if (!controller.signal.aborted) console.error(`[drive] 运行 ${runId} 异常`, err);
      await failRun(runId, controller.signal.aborted ? 'LIMIT' : 'INTERNAL',
        controller.signal.aborted ? '本轮运行已停止或超时，可重试' : '运行异常，可重试', true, emit, owner);
    }
  } finally {
    if (partialMessageId && partialText) await db.message.updateMany({ where: { id: partialMessageId, status: 'incomplete' }, data: { content: { blocks: [{ type: 'text', text: partialText }] } } });
    clearInterval(heartbeat);
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onDisconnect);
    if (activeControllers.get(runId) === controller) activeControllers.delete(runId);
    // 释放仍归属本执行者的租约
    await db.agentRun.updateMany({
      where: { id: runId, leaseBy: owner },
      data: { leaseBy: null, leaseUntil: null },
    });
  }
}

/** 终态失败：条件更新，迟到执行者无权覆盖取消/完成状态（§4.13） */
export async function failRun(
  runId: string,
  code: string,
  message: string,
  retryable: boolean,
  emit?: EventEmitter,
  owner?: string,
): Promise<void> {
  const updated = await db.agentRun.updateMany({
    where: { id: runId, status: { in: ['running', 'waiting_job'] }, ...(owner ? { leaseBy: owner } : {}) },
    data: { status: 'failed', error: { code, message, retryable }, finishedAt: new Date() },
  });
  if (updated.count > 0) {
    emit?.({ type: 'run.failed', runId, error: { code, message, retryable } });
  }
}

async function loadSubjectText(subjectRevisionId: string | null): Promise<string> {
  if (!subjectRevisionId) return '';
  const subject = await db.subjectRevision.findUnique({ where: { id: subjectRevisionId } });
  return (subject?.content as { text?: string } | null)?.text ?? '';
}

/** respond 终态校验（§4.11）：finish 必须满足目标成果已真实存在 */
async function validateRespond(
  disposition: 'wait_user' | 'finish',
  taskFrame: TaskFrame,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (disposition === 'wait_user' && taskFrame.goals.some((g) => g.failure)) return { ok: true };
  const uncompleted = taskFrame.goals.filter((g) => !g.completedArtifactId);
  if (uncompleted.length > 0) {
    const name = (t: 'lesson' | 'practice') => (t === 'lesson' ? '图文讲义' : '同类题组');
    return { ok: false, message: `respond.finish 前提不满足：${uncompleted.map((g) => name(g.type)).join('、')} 尚未完成（任务排队不是完成）。请等待工具结果，或改用 wait_user。` };
  }
  return { ok: true };
}

function markGoalsStarted(
  taskFrame: TaskFrame,
  jobs: Array<{ toolCallId: string; jobId: string; artifactType: string }>,
): void {
  for (const job of jobs) {
    const goal = taskFrame.goals.find((g) => g.type === (job.artifactType === 'lesson' ? 'lesson' : 'practice') && !g.completedArtifactId);
    if (goal) goal.startedJobId = job.jobId;
  }
}

function mergeGoalCompletions(
  taskFrame: TaskFrame,
  results: Array<{ toolCallId: string; toolName: string; value: unknown }>,
): void {
  for (const r of results) {
    const v = r.value as { ok?: boolean; artifactId?: string; status?: string; type?: string } | undefined;
    if (v?.ok === false) {
      const type = r.toolName === 'createLesson' ? 'lesson' : r.toolName === 'createPractice' ? 'practice' : null;
      for (const goal of taskFrame.goals) if (goal.type === type && !goal.completedArtifactId) goal.failure = true;
    }
    if (!v?.ok || !v.artifactId) continue;
    // 工具结果用材料枚举（lesson/exercise_set），TaskFrame 目标用 lesson/practice —— 在此统一
    const goalType: 'lesson' | 'practice' = v.type === 'lesson' ? 'lesson' : 'practice';
    for (const goal of taskFrame.goals) {
      if (goal.type === goalType && !goal.completedArtifactId && v.status === 'published') {
        goal.completedArtifactId = v.artifactId;
      }
    }
  }
}

async function updateStage(tx: Prisma.TransactionClient, conversationId: string, policy: { stage: string; subjectConfirmed: boolean; subjectId: string }, taskFrame: TaskFrame): Promise<void> {
  let stage: string = policy.stage;
  if (taskFrame.goals.some((g) => g.type === 'lesson' && g.completedArtifactId) || taskFrame.kind === 'solution') {
    stage = 'explaining';
  } else if (taskFrame.goals.some((g) => g.type === 'practice' && g.completedArtifactId)) {
    stage = 'practicing';
  } else if (policy.stage === 'clarifying' && policy.subjectConfirmed) {
    stage = 'guiding';
  }
  await tx.learningProgress.upsert({
    where: { subjectId: policy.subjectId },
    update: { version: { increment: 1 }, stage: stage as never },
    create: { conversationId, subjectId: policy.subjectId, stage: stage as never },
  });
}

/** 联调脚本（无模型凭据时）：按运行状态给确定性步骤，保证协议与恢复路径可端到端验证 */
function mockStep(
  policy: { subjectConfirmed: boolean; subjectRevisionId: string | null },
  taskFrame: TaskFrame,
  subjectText: string,
): AgentStep {
  const pendingGoal = taskFrame.goals.find((g) => !g.completedArtifactId && !g.failure);
  if (pendingGoal && policy.subjectConfirmed) {
    const call: ToolCall =
      pendingGoal.type === 'lesson'
        ? { toolCallId: `mock_${randomUUID().slice(0, 8)}`, toolName: 'createLesson', input: { target: pendingGoal.target ?? '按已确认范围生成讲义' } }
        : { toolCallId: `mock_${randomUUID().slice(0, 8)}`, toolName: 'createPractice', input: { count: pendingGoal.count ?? 2 } };
    return { kind: 'tool_calls', calls: [call] };
  }
  if (taskFrame.goals.some((g) => g.failure)) return { kind: 'respond', disposition: 'wait_user', text: '材料任务未完成，请调整输入后重试。', refs: [] };
  if (taskFrame.goals.length > 0 && policy.subjectConfirmed) {
    const parts = taskFrame.goals.map((g) =>
      g.type === 'lesson' ? '图文讲义已生成，可在成果里查看' : '同类题组已生成，可以开始作答',
    );
    return {
      kind: 'respond',
      disposition: 'finish',
      text: `（联调模式）${parts.join('；')}。继续追问随时说。`,
      refs: [],
    };
  }
  if (taskFrame.kind === 'solution') {
    return { kind: 'respond', disposition: 'wait_user', text: mockSolution(), refs: [] };
  }
  if (!policy.subjectConfirmed) {
    return { kind: 'respond', disposition: 'wait_user', text: mockClarify(subjectText), refs: [] };
  }
  return { kind: 'respond', disposition: 'wait_user', text: mockGuide(''), refs: [] };
}

export { initialCounters };
