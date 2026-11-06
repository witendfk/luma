import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
Object.assign(process.env, { NODE_ENV: 'test', LUMA_DEV_FAKE_LOGIN: 'false', LUMA_MOCK_AGENT: 'true' });

async function main() {
  const { db } = await import('../src/lib/db');
  const { conversationService } = await import('../src/services/conversation.service');
  const { subjectService } = await import('../src/services/subject.service');
  const { runService } = await import('../src/services/run.service');
  const { buildPolicy } = await import('../src/agent/policy');
  const { evidencePack, applyTeachingMemory } = await import('../src/agent/teaching-memory');
  const { readLearningContext } = await import('../src/agent/tool-executor');
  const { executeBatch } = await import('../src/agent/tool-executor');
  const { initialCounters } = await import('../src/agent/limits');
  const { lessonTask } = await import('../src/jobs/lesson.task');
  const { withActiveRun } = await import('../src/agent/run-guard');
  const host = new URL(process.env.DATABASE_URL!).hostname;
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(host), '仅允许本机隔离账号');
  const users = await Promise.all([0, 1].map(() => db.user.create({ data: { openid: `dev:memory-check-${randomUUID()}` } })));
  try {
    const [user, other] = users;
    const convo = await conversationService.create(user!.id, { initialText: '二次函数的图像', subjectType: 'knowledge' });
    let detail = await conversationService.get(user!.id, convo.id);
    const subjectId = detail.subject!.subjectId;
    await subjectService.update(user!.id, convo.id, { action: 'confirm', subjectId, expectedRevision: 1 });
    const policy = await buildPolicy({ conversationId: convo.id, subjectId });
    const revisionId = policy.subjectRevisionId!;
    const oldJson = (await db.subjectRevision.findUniqueOrThrow({ where: { id: revisionId } })).teachingState;
    const context = { userId: user!.id, conversationId: convo.id, policy };
    const pair = async (student: string, assistant = '先看两侧等高点，再比较镜像关系。') => {
      const first = await db.message.create({ data: { conversationId: convo.id, subjectId, subjectRevisionId: revisionId, role: 'user', content: { blocks: [{ type: 'text', text: student }], focus: {} } } });
      const second = await db.message.create({ data: { conversationId: convo.id, subjectId, subjectRevisionId: revisionId, role: 'assistant', content: { blocks: [{ type: 'text', text: assistant }], focus: {} } } });
      return { first, second };
    };
    const original = await pair('请只用图像法。我的卡点是左右对称。我的尝试是x=3。');
    const write = (source: typeof original, operations: any[], p = policy) => db.$transaction((tx) => applyTeachingMemory(tx, {
      revisionId, userMessageId: source.first.id, messageId: source.second.id, policy: p, operations,
    }));
    const result = await write(original, [
      { action: 'add', kind: 'request', text: '只用图像法', source: 'student', quote: '请只用图像法。' },
      { action: 'add', kind: 'difficulty', text: '左右对称', source: 'student', quote: '我的卡点是左右对称。' },
      { action: 'add', kind: 'attempt', text: '尝试x=3，未核验', source: 'student', quote: '我的尝试是x=3。' },
      { action: 'add', kind: 'method', text: '镜像法', source: 'assistant', quote: '先看两侧等高点，再比较镜像关系。' },
    ]);
    assert.equal(result.accepted.length, 4); assert.equal(result.rejected.length, 0);
    for (let i = 0; i < 16; i++) await write(original, [{ action: 'add', kind: 'difficulty', text: `仍未解决的独立卡点${i}`, source: 'student', quote: '我的卡点是左右对称。' }]);
    let pack = (await evidencePack(context))!;
    assert.equal(pack.items.length, 20, '同类条目不覆盖、不按12条淘汰');
    assert.equal(pack.items.find((m) => m.kind === 'attempt')!.status, 'candidate');
    assert.ok(pack.items.every((m) => !m.verificationRef));
    const request = pack.items.find((m) => m.kind === 'request')!;
    const difficulty = pack.items.find((m) => m.kind === 'difficulty' && m.text === '左右对称')!;
    const corrected = await pair('改成图像结合代数。左右对称的问题我已经理解。');
    const correction = await write(corrected, [
      { action: 'supersede', kind: 'request', targetId: request.id, expectedVersion: request.version, text: '图像结合代数', source: 'student', quote: '改成图像结合代数。' },
      { action: 'resolve', kind: 'difficulty', targetId: difficulty.id, expectedVersion: difficulty.version, source: 'student', quote: '左右对称的问题我已经理解。' },
    ]);
    assert.equal(correction.rejected.length, 0);
    assert.equal((await db.teachingMemory.findUniqueOrThrow({ where: { id: request.id } })).status, 'superseded');
    assert.equal((await db.teachingMemory.findUniqueOrThrow({ where: { id: difficulty.id } })).status, 'resolved');
    pack = (await evidencePack(context))!;
    assert.ok(!pack.items.some((m) => m.id === request.id || m.id === difficulty.id));
    assert.ok(pack.items.some((m) => m.kind === 'request' && m.text === '图像结合代数'));
    const invalid = await write(corrected, [
      { action: 'resolve', kind: 'difficulty', targetId: difficulty.id, expectedVersion: 999, source: 'student', quote: '左右对称的问题我已经理解。' },
      { action: 'add', kind: 'request', text: '伪造要求', source: 'student', quote: '用户从未说过的原话' },
    ]);
    assert.deepEqual(invalid.rejected.map((r) => r.code), ['MEMORY_CONFLICT', 'EVIDENCE_MISMATCH']);
    assert.deepEqual((await db.subjectRevision.findUniqueOrThrow({ where: { id: revisionId } })).teachingState, oldJson, '不破坏旧JSON');
    console.log('PASS 20条记忆保留、来源、错误尝试、替代/解决、并发版本及原JSON保留');

    const formula = await pair('请比较 f(x)=x²−4x+7 的图像。');
    const forbidden = await db.message.create({ data: { conversationId: convo.id, subjectId, subjectRevisionId: revisionId, role: 'assistant', content: { blocks: [{ type: 'text', text: '完整解析专有暗号答案' }], focus: {}, containsSolution: true } } });
    const wrongExercise = await db.message.create({ data: { conversationId: convo.id, subjectId, subjectRevisionId: revisionId, role: 'assistant', content: { blocks: [{ type: 'text', text: '别题专有暗号答案' }], focus: { attemptId: 'p', exerciseId: 'e2' } } } });
    const search = await readLearningContext(context, { ref: 'messages', query: 'x^2 -4x' }) as any;
    assert.equal(search.ok, true); assert.ok(search.hits.some((m: any) => m.id === formula.first.id));
    const exact = await readLearningContext(context, { ref: 'messages', messageIds: [original.first.id] }) as any;
    assert.equal(exact.messages[0].text, '请只用图像法。我的卡点是左右对称。我的尝试是x=3。');
    const round = await readLearningContext(context, { ref: 'messages', aroundMessageId: original.second.id }) as any;
    assert.ok(round.messages.some((m: any) => m.id === original.first.id)); assert.ok(round.messages.some((m: any) => m.id === original.second.id));
    assert.ok(!round.messages.some((m: any) => m.id === corrected.first.id));
    for (const id of [forbidden.id, wrongExercise.id]) assert.equal((await readLearningContext(context, { ref: 'messages', messageIds: [id] }) as any).ok, false);
    assert.equal((await readLearningContext(context, { ref: 'messages', query: '专有暗号' }) as any).hits.length, 0);
    assert.equal((await readLearningContext({ ...context, userId: other!.id }, { ref: 'messages', messageIds: [original.first.id] }) as any).ok, false);
    assert.equal((await evidencePack({ ...context, userId: other!.id })), null);
    const snapshot = JSON.parse(JSON.stringify(pack));
    await write(corrected, [{ action: 'add', kind: 'request', text: '新增要求', source: 'student', quote: '改成图像结合代数。' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(pack)), snapshot, '任务快照不被后续记忆更新改写');
    console.log('PASS 中文/数学定位、完整轮次、精确回读、跨账号/练习/解析隔离及固定证据快照');

    const started = await runService.startRun(user!.id, convo.id, { requestId: randomUUID(), text: '前面那个方法是什么？' });
    assert.equal((started.run.taskFrame as any).readback.status, 'pending');
    await db.agentRun.update({ where: { id: started.run.id }, data: { leaseBy: 'memory-check', leaseUntil: new Date(Date.now() + 60000) } });
    await runService.cancel(user!.id, started.run.id);
    await assert.rejects(withActiveRun(started.run.id, 'memory-check', async () => { throw new Error('不能执行'); }), /停止/);
    const materialRun = await runService.startRun(user!.id, convo.id, { requestId: randomUUID(), text: '请用纸带数轴法生成图文讲解。', action: 'generate_lesson' });
    await db.agentRun.update({ where: { id: materialRun.run.id }, data: { leaseBy: 'memory-material', leaseUntil: new Date(Date.now() + 60000) } });
    await withActiveRun(materialRun.run.id, 'memory-material', (tx) => applyTeachingMemory(tx, {
      revisionId, userMessageId: materialRun.run.userMessageId!, messageId: materialRun.run.userMessageId!, policy,
      operations: [{ action: 'add', kind: 'request', text: '纸带数轴法', source: 'student', quote: '请用纸带数轴法生成图文讲解。' }],
    }));
    const outcome = await executeBatch({ ...context, runId: materialRun.run.id, leaseOwner: 'memory-material', counters: initialCounters() },
      { decisionId: 'memory-material', items: [{ toolCallId: 'memory-create', toolName: 'createLesson', input: { target: '用纸带数轴法帮助理解' } }] });
    assert.equal(outcome.kind, 'waiting');
    const job = await db.generationJob.findFirstOrThrow({ where: { runId: materialRun.run.id } });
    const payload = job.payload as any;
    assert.ok(payload.evidence.items.some((m: any) => m.kind === 'request' && m.text === '纸带数轴法'), '同轮提出要求必须进入任务快照');
    const materialBefore = await db.teachingMemory.count({ where: { subjectRevisionId: revisionId } });
    await db.generationJob.update({ where: { id: job.id }, data: { status: 'running', leasedBy: 'memory-material-worker', leasedUntil: new Date(Date.now() + 60000) } });
    await lessonTask({ jobId: job.id, workerId: 'memory-material-worker' });
    assert.equal((await db.generationJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'succeeded');
    assert.equal(await db.teachingMemory.count({ where: { subjectRevisionId: revisionId } }), materialBefore, '发布讲义不写章节标题或挤占卡点');
    await runService.cancel(user!.id, materialRun.run.id);
    console.log('PASS 同轮讲法要求进入真实任务固定快照，发布讲义不覆盖教学记忆');
    await subjectService.update(user!.id, convo.id, { action: 'update', subjectId, expectedRevision: 1, content: { text: '新条件：一次函数' } });
    const newPolicy = await buildPolicy({ conversationId: convo.id, subjectId });
    assert.equal((await evidencePack({ ...context, policy: newPolicy }))!.items.length, 0);
    assert.equal((await readLearningContext({ ...context, policy: newPolicy }, { ref: 'messages', messageIds: [original.first.id] }) as any).ok, false);
    assert.equal(await db.teachingMemory.count({ where: { subjectRevisionId: revisionId } }), 23, '新版本不删除旧记忆');
    console.log('PASS 回读门槛落库、取消拒绝迟到更新、新版本不继承且保留原记忆');
  } finally {
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await db.$disconnect();
  }
}
main().catch((error) => { console.error(error instanceof assert.AssertionError ? error.message : '教学记忆检查失败（不输出凭据）'); process.exitCode = 1; });
