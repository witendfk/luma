import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
async function main() {
  const { env } = await import('../src/lib/env');
  const { db } = await import('../src/lib/db');
  const { drive } = await import('../src/agent/loop');
  const { runService } = await import('../src/services/run.service');
  const { conversationService } = await import('../src/services/conversation.service');
  const { subjectService } = await import('../src/services/subject.service');
  const { textOf } = await import('../src/agent/blocks');
  const real = !env().LUMA_MOCK_AGENT;
  const retryIndex = process.argv.indexOf('--retry-job');
  if (retryIndex >= 0) {
    try {
      const source = await db.generationJob.findUniqueOrThrow({ where: { id: process.argv[retryIndex + 1] }, include: { conversation: true } });
      const { jobService } = await import('../src/services/job.service');
      const retry = await jobService.retry(source.conversation.userId, source.id);
      const deadline = Date.now() + 150000;
      let job = await db.generationJob.findUniqueOrThrow({ where: { id: retry.id } });
      while (['queued', 'running'].includes(job.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        job = await db.generationJob.findUniqueOrThrow({ where: { id: retry.id } });
      }
      assert.equal(job.status, 'succeeded', JSON.stringify(job.error));
      assert.ok(job.resultArtifactId);
      let run = await db.agentRun.findUniqueOrThrow({ where: { id: job.runId! } });
      while (['running', 'waiting_job'].includes(run.status) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        run = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
      }
      assert.ok(['completed', 'waiting_user'].includes(run.status), JSON.stringify(run.error));
      assert.ok((run.counters as any).background.requests >= (source.draftCheckpoint ? 1 : 2));
      console.log(JSON.stringify({ test: '真实材料任务失败重试、发布及 Agent 恢复', real, jobStatus: job.status, runStatus: run.status, artifactId: job.resultArtifactId, background: (run.counters as any).background }));
    } finally { await db.$disconnect(); }
    return;
  }
  const user = await db.user.create({ data: { openid: `dev:b02-${randomUUID()}` } });
  const req = () => `b02_${randomUUID()}`;
  try {
    const c = await conversationService.create(user.id, { initialText: '已知 f(x)=x²−2x+3，求 f(x) 的最小值。' });
    const cid = c.id, sid = (await conversationService.get(user.id, cid)).conversation.activeSubjectId!;
    await subjectService.update(user.id, cid, { action: 'confirm', expectedRevision: 1 });
    for (const [index, text] of ['请先给一个方向提示，不要给最终答案。', '我想用配方法，但不知道常数怎么处理。', '我写成了 (x-1)²+2，接下来应该考虑平方的性质吗？'].entries()) {
      const { run } = await runService.startRun(user.id, cid, { requestId: req(), text });
      const events: any[] = []; const started = Date.now(); let firstMs: number | null = null;
      await drive(run.id, (event) => { events.push(event); if (event.type === 'text.delta' && firstMs === null) firstMs = Date.now() - started; });
      const saved = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
      assert.ok(['waiting_user','completed'].includes(saved.status), JSON.stringify(saved.error));
      const reply = await db.message.findFirstOrThrow({ where: { runId: run.id, role: 'assistant', status: 'complete' } });
      const deltas = events.filter((e) => e.type === 'text.delta');
      assert.equal(deltas.map((e) => e.delta).join(''), textOf(reply.content));
      console.log(JSON.stringify({ test: `教学第${index+1}轮`, real, firstMs, elapsedMs: Date.now() - started, chunks: deltas.length, reply: textOf(reply.content), counters: saved.counters }));
    }
    const cancelled = await runService.startRun(user.id, cid, { requestId: req(), text: '我主动请求完整解析，请解释配方每一步。', action: 'show_solution' });
    let stop: Promise<unknown> | undefined, chunks = 0;
    await drive(cancelled.run.id, (event) => {
      if (event.type === 'text.delta') { chunks++; stop ??= runService.cancel(user.id, cancelled.run.id); }
    });
    await stop;
    const cancelledRow = await db.agentRun.findUniqueOrThrow({ where: { id: cancelled.run.id } });
    assert.equal(cancelledRow.status, 'cancelled');
    assert.equal(await db.message.count({ where: { runId: cancelled.run.id, status: 'complete', role: 'assistant' } }), 0);
    const originalUsers = await db.message.count({ where: { conversationId: cid, role: 'user' } });
    const retry = await runService.startRun(user.id, cid, { requestId: req(), retryOfRunId: cancelled.run.id });
    assert.equal(retry.run.userMessageId, cancelled.run.userMessageId);
    assert.equal(await db.message.count({ where: { conversationId: cid, role: 'user' } }), originalUsers);
    const repeat = await runService.startRun(user.id, cid, { requestId: req(), retryOfRunId: cancelled.run.id });
    assert.equal(repeat.run.id, retry.run.id);
    await drive(retry.run.id);
    const retried = await db.agentRun.findUniqueOrThrow({ where: { id: retry.run.id } });
    assert.ok(['completed','waiting_user'].includes(retried.status), JSON.stringify(retried.error));
    const detail = await conversationService.get(user.id, cid);
    assert.equal(detail.latestRun?.id, retry.run.id);
    const solution = await db.message.findFirstOrThrow({ where: { runId: retry.run.id, role: 'assistant' } });
    console.log(JSON.stringify({ test: '停止/显式重试/重进', real, chunksBeforeStop: chunks, userMessageReused: true, reply: textOf(solution.content) }));
    const failed = await runService.startRun(user.id, cid, { requestId: req(), text: '旧输入测试' });
    await runService.cancel(user.id, failed.run.id);
    await runService.startRun(user.id, cid, { requestId: req(), text: '新的提问' });
    await assert.rejects(runService.startRun(user.id, cid, { requestId: req(), retryOfRunId: failed.run.id }));
    console.log('PASS 后续提问存在时拒绝重试旧输入');
    if (real) {
      const combo = await runService.startRun(user.id, cid, { requestId: req(), text: '请把配方法整理成讲义，并另外给两道同类练习。' });
      await drive(combo.run.id);
      const pending = await db.agentRun.findUniqueOrThrow({ where: { id: combo.run.id } });
      const frame = pending.taskFrame as any;
      assert.deepEqual(frame.goals.map((g: any) => g.type).sort(), ['lesson','practice']);
      assert.equal(pending.status, 'waiting_job', JSON.stringify(pending.error));
      console.log(JSON.stringify({ test: '真实自由输入组合目标与后台停靠', goals: frame.goals, status: pending.status }));
      if (process.argv.includes('--materials')) {
        const deadline = Date.now() + 150000;
        let done = pending;
        while (['running','waiting_job'].includes(done.status) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          done = await db.agentRun.findUniqueOrThrow({ where: { id: combo.run.id } });
        }
        assert.equal(done.status, 'completed', JSON.stringify(done.error));
        assert.ok((done.taskFrame as any).goals.every((g: any) => g.completedArtifactId));
        assert.ok((done.counters as any).background.requests >= 4);
        console.log(JSON.stringify({ test: '组合任务真实 worker 恢复并完成', status: done.status, counters: done.counters }));
      } else await runService.cancel(user.id, combo.run.id);
    }
  } finally {
    await db.user.delete({ where: { id: user.id } }); await db.$disconnect();
  }
}
main().catch((err) => { console.error(err instanceof Error ? err.message : 'B02 检查失败'); process.exitCode = 1; });
