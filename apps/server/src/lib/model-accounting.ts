import { Prisma } from '@prisma/client';
import { db } from './db';
import { env } from './env';
import { countersFrom, initialCounters, recordModelRequest, reservedTokens, reserveModelRequest, settleModelRequest, type RunCounters } from '../agent/limits';
import { withActiveRun } from '../agent/run-guard';

export type JobModelTrace = { jobId: string; workerId: string };
export function aggregateJobUsage(rows: Array<{ counters: unknown }>) {
  return rows.reduce((sum, row) => {
    const c = countersFrom(row.counters), reserved = reservedTokens(c);
    sum.requests += Object.values(c.modelRequests).reduce((n, count) => n + count, 0);
    sum.input += c.tokens.input; sum.output += c.tokens.output; sum.unknown += c.unknownUsageCalls;
    sum.cachedInput += c.tokens.cachedInput ?? 0;
    sum.reservedInput += reserved.input; sum.reservedOutput += reserved.output;
    return sum;
  }, { requests: 0, input: 0, output: 0, unknown: 0, cachedInput: 0, reservedInput: 0, reservedOutput: 0 });
}

/** Foreground/summary and jobs use the SAME lock and refresh background reservations before admission. */
export async function reserveRunModel(input: { runId: string; owner: string; counters: RunCounters; purpose: string; inputTokens: number; outputTokens: number }) {
  return withActiveRun(input.runId, input.owner, async (tx) => {
    input.counters.background = aggregateJobUsage(await tx.generationJob.findMany({ where: { runId: input.runId }, select: { counters: true } }));
    const callId = reserveModelRequest(input.counters, input.purpose, input.inputTokens, input.outputTokens);
    await tx.agentRun.update({ where: { id: input.runId }, data: { counters: input.counters as unknown as Prisma.InputJsonValue } });
    return callId;
  });
}

type ModelResult = { callId: string; durationMs: number; model?: string; usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }; error?: string };

/** Reserve on the job under the conversation lock. A failed/abandoned call retains its conservative occupancy. */
export async function accountJobModel(trace: JobModelTrace, purpose: string,
  request: { inputTokens: number; outputTokens: number } | ModelResult): Promise<string> {
  return db.$transaction(async (tx) => {
    const job = await tx.generationJob.findUniqueOrThrow({ where: { id: trace.jobId } });
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${job.conversationId} FOR UPDATE`;
    const current = await tx.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    if (current.status !== 'running' || current.leasedBy !== trace.workerId || !current.leasedUntil || current.leasedUntil <= new Date()) throw new Error('任务已停止');
    const counters = countersFrom(current.counters);
    let callId: string;
    if (!('callId' in request)) {
      const parent = job.runId ? await tx.agentRun.findUnique({ where: { id: job.runId } }) : null;
      if ((parent && !['running', 'waiting_job'].includes(parent.status)) || (parent?.deadlineAt && parent.deadlineAt <= new Date()) ||
        (current.deadlineAt && current.deadlineAt <= new Date())) throw new Error('本轮或任务已停止或超时');
      const all = job.runId ? await tx.generationJob.findMany({ where: { runId: job.runId }, select: { counters: true } }) : [{ counters: current.counters }];
      const aggregate = parent ? countersFrom(parent.counters) : initialCounters();
      aggregate.background = aggregateJobUsage(all);
      if (purpose === 'image' && (counters.modelRequests.image ?? 0) >= 2) throw new Error('本任务配图生成已达两次上限');
      callId = reserveModelRequest(aggregate, purpose, request.inputTokens, request.outputTokens);
      counters.modelReservations[callId] = aggregate.modelReservations[callId]!;
      recordModelRequest(counters, purpose);
    } else {
      callId = request.callId;
      if (counters.modelReservations[callId]?.purpose !== purpose) throw new Error('模型调用记录不匹配');
      if (!settleModelRequest(counters, callId, request.usage)) return callId;
      counters.calls.push({ purpose, model: request.model ?? env().LUMA_MODEL_ID, attempt: counters.modelRequests[purpose] ?? 1, durationMs: request.durationMs,
        inputTokens: request.usage?.inputTokens ?? null, outputTokens: request.usage?.outputTokens ?? null,
        cachedInputTokens: request.usage?.cachedInputTokens ?? null, ...(request.error ? { error: request.error } : {}) });
    }
    await tx.generationJob.update({ where: { id: job.id }, data: { counters: counters as unknown as Prisma.InputJsonValue } });
    return callId;
  });
}
