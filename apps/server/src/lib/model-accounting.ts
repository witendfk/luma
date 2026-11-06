import { Prisma } from '@prisma/client';
import { db } from './db';
import { env } from './env';
import { countersFrom, initialCounters, modelBudgetAvailable, recordModelRequest, recordUsage, type RunCounters } from '../agent/limits';

export type JobModelTrace = { jobId: string; workerId: string };
export function aggregateJobUsage(rows: Array<{ counters: unknown }>) {
  return rows.reduce((sum, row) => {
    const c = countersFrom(row.counters);
    sum.requests += Object.values(c.modelRequests).reduce((n, count) => n + count, 0);
    sum.input += c.tokens.input; sum.output += c.tokens.output; sum.unknown += c.unknownUsageCalls;
    sum.cachedInput += c.tokens.cachedInput ?? 0;
    return sum;
  }, { requests: 0, input: 0, output: 0, unknown: 0, cachedInput: 0 });
}

/** Reserve on the job, under the same conversation lock. Parent reads the aggregate; no competing JSON overwrites. */
export async function accountJobModel(trace: JobModelTrace, purpose: string, result?: { durationMs: number; model?: string; usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }; error?: string }) {
  await db.$transaction(async (tx) => {
    const job = await tx.generationJob.findUniqueOrThrow({ where: { id: trace.jobId } });
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${job.conversationId} FOR UPDATE`;
    const current = await tx.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    if (current.status !== 'running' || current.leasedBy !== trace.workerId || !current.leasedUntil || current.leasedUntil <= new Date()) throw new Error('任务已停止');
    const counters = countersFrom(current.counters);
    if (!result) {
      const parent = job.runId ? await tx.agentRun.findUnique({ where: { id: job.runId } }) : null;
      const all = job.runId ? await tx.generationJob.findMany({ where: { runId: job.runId }, select: { counters: true } }) : [{ counters: current.counters }];
      const aggregate = parent ? countersFrom(parent.counters) : initialCounters();
      aggregate.background = aggregateJobUsage(all);
      if (!modelBudgetAvailable(aggregate) || (parent?.deadlineAt && parent.deadlineAt <= new Date())) throw new Error('模型请求或累计用量已达保护上限');
      if (purpose === 'image' && (counters.modelRequests.image ?? 0) >= 2) throw new Error('本任务配图生成已达两次上限');
      recordModelRequest(counters, purpose);
    } else {
      recordUsage(counters, result.usage);
      counters.calls.push({ purpose, model: result.model ?? env().LUMA_MODEL_ID, attempt: counters.modelRequests[purpose] ?? 1, durationMs: result.durationMs,
        inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null,
        cachedInputTokens: result.usage?.cachedInputTokens ?? null, ...(result.error ? { error: result.error } : {}) });
    }
    await tx.generationJob.update({ where: { id: job.id }, data: { counters: counters as unknown as Prisma.InputJsonValue } });
  });
}
