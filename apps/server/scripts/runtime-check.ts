import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadWorkerEnv } from '../src/worker/load-env';

// 仅创建并清理本脚本的唯一测试账号；需要本地 PostgreSQL 和运行中的 worker。
loadWorkerEnv();
async function main() {
  const { db } = await import('../src/lib/db');
  const { runService } = await import('../src/services/run.service');
  const { conversationService } = await import('../src/services/conversation.service');
  const { subjectService } = await import('../src/services/subject.service');
  const { practiceService } = await import('../src/services/practice.service');
  const { artifactService } = await import('../src/services/artifact.service');
  const { jobService } = await import('../src/services/job.service');
  const { drive } = await import('../src/agent/loop');
  const { executeBatch } = await import('../src/agent/tool-executor');
  const { initialCounters } = await import('../src/agent/limits');
  const { buildPolicy } = await import('../src/agent/policy');
  const { withActiveRun, RunStoppedError } = await import('../src/agent/run-guard');
  const { failExpiredRuns } = await import('../src/jobs/scheduler');
  const user = await db.user.create({ data: { openid: `dev:runtime-${randomUUID()}` } });
  const uid = user.id;
  const requestId = () => `test_${randomUUID()}`;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const conversation = await conversationService.create(uid, {});
    const cid = conversation.id;
    const sid = (await db.conversation.findUniqueOrThrow({ where: { id: cid } })).activeSubjectId!;
    const input = { requestId: requestId(), text: '已知 f(x)=x²-2x+3，求最小值。' };
    const pair = await Promise.all([runService.startRun(uid, cid, input), runService.startRun(uid, cid, input)]);
    assert.equal(pair[0].run.id, pair[1].run.id);
    assert.equal(await db.subjectRevision.count({ where: { conversationId: cid } }), 1);
    assert.equal(await db.message.count({ where: { conversationId: cid, role: 'user' } }), 1);
    const events: any[] = [];
    await drive(pair[0].run.id, (event) => events.push(event));
    assert.ok(events.some((event) => event.type === 'text.delta' && event.delta.includes('核对')), JSON.stringify(events));
    assert.equal(((await db.subjectRevision.findFirstOrThrow({ where: { subjectId: sid } })).content as { text: string }).text, input.text);
    assert.equal((await db.learningProgress.findUniqueOrThrow({ where: { subjectId: sid } })).stage, 'clarifying');
    await subjectService.update(uid, cid, { action: 'confirm', expectedRevision: 1 });
    const next = await runService.startRun(uid, cid, { requestId: requestId(), text: '为什么这样想？' });
    assert.equal((next.run.protocol as any[]).length, 3);
    await drive(next.run.id);
    console.log('PASS 真库首题建立、并发请求幂等、核对阶段、历史上下文');

    const cancelled = await runService.startRun(uid, cid, { requestId: requestId(), text: '取消测试' });
    const before = await db.learningProgress.findUniqueOrThrow({ where: { subjectId: sid } });
    const pending = drive(cancelled.run.id);
    await wait(50);
    await runService.cancel(uid, cancelled.run.id);
    await pending;
    assert.equal(await db.message.count({ where: { runId: cancelled.run.id, role: 'assistant' } }), 0);
    assert.equal((await db.agentRun.findUniqueOrThrow({ where: { id: cancelled.run.id } })).status, 'cancelled');
    assert.equal((await db.learningProgress.findUniqueOrThrow({ where: { subjectId: sid } })).updatedAt.getTime(), before.updatedAt.getTime());
    let wrote = false;
    await assert.rejects(withActiveRun(cancelled.run.id, 'old-owner', async () => { wrote = true; }), RunStoppedError);
    assert.equal(wrote, false);
    console.log('PASS 取消时模型迟到返回不写消息、不改阶段、不复活运行');

    const timed = await runService.startRun(uid, cid, { requestId: requestId(), text: '超时测试' });
    await db.agentRun.update({ where: { id: timed.run.id }, data: { deadlineAt: new Date(Date.now() + 20) } });
    await drive(timed.run.id);
    assert.equal((await db.agentRun.findUniqueOrThrow({ where: { id: timed.run.id } })).status, 'failed');
    const orphan = await runService.startRun(uid, cid, { requestId: requestId(), text: '中断测试' });
    await db.agentRun.update({ where: { id: orphan.run.id }, data: { leaseBy: 'dead-process', leaseUntil: new Date(0) } });
    await failExpiredRuns();
    assert.equal((await db.agentRun.findUniqueOrThrow({ where: { id: orphan.run.id } })).status, 'failed');
    console.log('PASS 总截止时间及进程中断有明确失败终态');

    const subject = await db.subjectRevision.findFirstOrThrow({ where: { conversationId: cid } });
    const lesson = await db.artifact.create({ data: {
      conversationId: cid, subjectRevisionId: subject.id, type: 'lesson', version: 1, publishStatus: 'published',
      content: { lesson: { title: '配方法', sections: [{ id: 's1', heading: '配方', body: 'x²-2x+3=(x-1)²+2' }, { id: 's2', heading: '结论', body: '平方非负' }] } },
    } });
    const focused = await runService.startRun(uid, cid, { requestId: requestId(), text: '这一步怎么配方？', artifactId: lesson.id, sectionId: 's1' });
    const callId = requestId();
    await db.toolExecution.create({ data: { runId: focused.run.id, decisionId: 'test', toolCallId: callId, tool: 'readLearningContext', batchOrder: 0, status: 'pending' } });
    const result = await executeBatch({ userId: uid, conversationId: cid, runId: focused.run.id, leaseOwner: 'test',
      policy: await buildPolicy({ conversationId: cid, subjectId: sid, focus: { artifactId: lesson.id, sectionId: 's1' } }), counters: initialCounters() },
      { decisionId: 'test', items: [{ toolCallId: callId, toolName: 'readLearningContext', input: { ref: 'artifacts', sectionId: 's1' } }] });
    assert.equal(result.kind, 'results');
    if (result.kind === 'results') {
      const value: any = result.results[0]!.value;
      assert.equal(value.lesson.sections.length, 1);
      assert.match(value.lesson.sections[0].body, /x-1/);
    }
    await runService.cancel(uid, focused.run.id);
    console.log('PASS 段落追问读取指定讲义真实正文');

    const exerciseSet = await db.artifact.create({ data: {
      conversationId: cid, subjectRevisionId: subject.id, type: 'exercise_set', version: 1, publishStatus: 'published', content: { count: 2 },
      exercises: { create: [1, 2].map((order) => ({ order, stem: `题目${order}`, answer: '0', analysis: '平方非负', topic: '函数', difficulty: 'basic', purpose: '巩固' })) },
    }, include: { exercises: { orderBy: { order: 'asc' } } } });
    const ex = exerciseSet.exercises[0]!;
    const attempt = await practiceService.start(uid, { artifactId: exerciseSet.id, exerciseIds: [ex.id] });
    await practiceService.saveAnswer(uid, attempt.id, ex.id, { textDraft: 'v1', draftVersion: 1 });
    await Promise.allSettled([
      practiceService.saveAnswer(uid, attempt.id, ex.id, { textDraft: 'v3', draftVersion: 3 }),
      practiceService.saveAnswer(uid, attempt.id, ex.id, { textDraft: 'v2', draftVersion: 2 }),
    ]);
    const answer = await db.practiceAnswer.findUniqueOrThrow({ where: { attemptId_exerciseId: { attemptId: attempt.id, exerciseId: ex.id } } });
    assert.equal(answer.draftVersion, 3);
    assert.equal(answer.textDraft, 'v3');
    await practiceService.submit(uid, attempt.id);
    await assert.rejects(practiceService.saveAnswer(uid, attempt.id, ex.id, { textDraft: 'late', draftVersion: 4 }));
    const view: any = await artifactService.get(uid, exerciseSet.id);
    assert.equal(view.exercises[0].answer, '0');
    assert.equal(view.exercises[1].answer, undefined);
    await practiceService.saveAnswer(uid, attempt.id, ex.id, { selfEval: 'independent', draftVersion: 4 });
    await practiceService.complete(uid, attempt.id);
    await assert.rejects(practiceService.saveAnswer(uid, attempt.id, ex.id, { selfEval: 'stuck', draftVersion: 5 }));
    console.log('PASS 真库并发草稿保持最高版本、提交后禁止改草稿、历史只读、未做题答案不泄漏');

    const failed = await db.generationJob.create({ data: {
      type: 'exercise_set', conversationId: cid, subjectId: sid, subjectRevisionId: subject.id, status: 'failed',
      payload: { subjectText: '求二次函数最小值', count: 2, tags: ['二次函数'] },
    } });
    const retry = await jobService.retry(uid, failed.id);
    const retryRow = await db.generationJob.findUniqueOrThrow({ where: { id: retry.id } });
    assert.deepEqual(retryRow.payload, failed.payload);
    assert.equal(retryRow.retryOfJobId, failed.id);
    assert.ok(retryRow.runId);
    assert.equal((await jobService.retry(uid, failed.id)).id, retry.id);
    const deadline = Date.now() + 20_000;
    for (;;) {
      const run = await db.agentRun.findUniqueOrThrow({ where: { id: retryRow.runId! } });
      if (run.status === 'completed') break;
      assert.notEqual(run.status, 'failed', JSON.stringify(run.error));
      assert.ok(Date.now() < deadline, 'worker 重试恢复超时');
      await wait(200);
    }
    console.log('PASS 重试保留输入、关联新运行、重复重试去重、worker 完成后 Agent 继续');
  } finally {
    await db.user.delete({ where: { id: uid } });
    await db.$disconnect();
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
