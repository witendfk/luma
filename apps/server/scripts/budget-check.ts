import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
Object.assign(process.env, { NODE_ENV: 'test', LUMA_DEV_FAKE_LOGIN: 'false', MAX_RUN_TOKENS: '1000', MAX_MODEL_REQUESTS: '8' });

/** Only admission/accounting services, never model adapters or generation workers. Own fixtures only. */
async function main() {
  const { db } = await import('../src/lib/db');
  const { conversationService } = await import('../src/services/conversation.service');
  const { accountJobModel, reserveRunModel, aggregateJobUsage } = await import('../src/lib/model-accounting');
  const { countersFrom, initialCounters, modelBudgetTotals, ModelBudgetError } = await import('../src/agent/limits');
  const user = await db.user.create({ data: { openid: `dev:budget-check-${randomUUID()}` } });
  try {
    const conversation = await conversationService.create(user.id, { initialText: '隔离预算检查', subjectType: 'knowledge' });
    const detail = await conversationService.get(user.id, conversation.id);
    const until = new Date(Date.now() + 3_600_000), owner = `budget-${randomUUID()}`;
    const run = await db.agentRun.create({ data: { conversationId: conversation.id, subjectId: detail.subject!.subjectId,
      subjectRevisionId: detail.subject!.id, requestId: randomUUID(), status: 'running', leaseBy: owner, leaseUntil: until,
      deadlineAt: until, promptVersion: 'budget-check', counters: initialCounters() as object } });
    const createJob = () => db.generationJob.create({ data: { conversationId: conversation.id, subjectId: detail.subject!.subjectId,
      subjectRevisionId: detail.subject!.id, runId: run.id, type: 'lesson', status: 'running', leasedBy: owner,
      leasedUntil: until, deadlineAt: until, payload: {}, counters: initialCounters() as object } });
    const jobs = await Promise.all([createJob(), createJob()]);
    const raced = await Promise.allSettled(jobs.map((job) => accountJobModel({ jobId: job.id, workerId: owner }, 'lesson_body', { inputTokens: 500, outputTokens: 200 })));
    assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1, '并发任务不能分别花费同一余额');
    const rejected = raced.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof ModelBudgetError);
    const winnerIndex = raced.findIndex((r) => r.status === 'fulfilled');
    const callId = (raced[winnerIndex] as PromiseFulfilledResult<string>).value, winner = jobs[winnerIndex]!;
    const trace = { jobId: winner.id, workerId: owner };
    let stored = await db.generationJob.findMany({ where: { runId: run.id }, select: { counters: true } });
    assert.equal(aggregateJobUsage(stored).reservedInput, 500);
    assert.equal(aggregateJobUsage(stored).requests, 1);
    // Reload the parent (a process restart) and include pending background use before a foreground request.
    let restored = countersFrom((await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).counters);
    await assert.rejects(reserveRunModel({ runId: run.id, owner, counters: restored, purpose: 'agent', inputTokens: 250, outputTokens: 100 }), ModelBudgetError);
    await accountJobModel(trace, 'lesson_body', { callId, durationMs: 1, usage: { inputTokens: 400, outputTokens: 100, cachedInputTokens: 300 } });
    await accountJobModel(trace, 'lesson_body', { callId, durationMs: 1, usage: { inputTokens: 400, outputTokens: 100 } });
    stored = await db.generationJob.findMany({ where: { runId: run.id }, select: { counters: true } });
    assert.equal(aggregateJobUsage(stored).input, 400, '重复结算不重复计量');
    restored = countersFrom((await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).counters);
    const foregroundId = await reserveRunModel({ runId: run.id, owner, counters: restored, purpose: 'agent', inputTokens: 400, outputTokens: 100 });
    const recovered = countersFrom((await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).counters);
    assert.equal(recovered.modelReservations[foregroundId]!.status, 'pending');
    assert.equal(modelBudgetTotals(recovered).tokens, 1000);
    await assert.rejects(reserveRunModel({ runId: run.id, owner, counters: recovered, purpose: 'context_summary', inputTokens: 1, outputTokens: 1 }), ModelBudgetError);
    // Pending pre-reservation survives cancellation and failed late settlement; never returns as zero.
    await db.agentRun.update({ where: { id: run.id }, data: { status: 'cancelled' } });
    await assert.rejects(accountJobModel({ jobId: jobs[1 - winnerIndex]!.id, workerId: owner }, 'lesson_review', { inputTokens: 0, outputTokens: 0 }), /停止/);
    await db.generationJob.update({ where: { id: winner.id }, data: { leasedBy: 'new-worker' } });
    await assert.rejects(accountJobModel(trace, 'lesson_review', { inputTokens: 0, outputTokens: 0 }), /停止/);
    console.log('PASS budget: concurrent job admission, foreground/background shared limit, request denial without mutation, actual settlement/idempotency, cached input counted, durable pending/recovery, parent cancellation and lease isolation; no model calls');
  } finally {
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
