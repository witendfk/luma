import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
Object.assign(process.env, { NODE_ENV: 'test', LUMA_DEV_FAKE_LOGIN: 'false', LUMA_MOCK_AGENT: 'false' });
async function main() {
  const { db } = await import('../src/lib/db');
  const { conversationService } = await import('../src/services/conversation.service');
  const { subjectService } = await import('../src/services/subject.service');
  const { runService } = await import('../src/services/run.service');
  const { drive } = await import('../src/agent/loop');
  const { buildPolicy } = await import('../src/agent/policy');
  const { evidencePack } = await import('../src/agent/teaching-memory');
  const { summaryScope } = await import('../src/agent/compaction');
  const { textOf } = await import('../src/agent/blocks');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname));
  const user = await db.user.create({ data: { openid: `dev:memory-live-${randomUUID()}` } });
  try {
    const convo = await conversationService.create(user.id, { initialText: '绝对值的几何意义', subjectType: 'knowledge' });
    const subjectId = (await conversationService.get(user.id, convo.id)).subject!.subjectId;
    await subjectService.update(user.id, convo.id, { action: 'confirm', subjectId, expectedRevision: 1 });
    const policy = await buildPolicy({ conversationId: convo.id, subjectId });
    const execute = async (text: string) => {
      const started = await runService.startRun(user.id, convo.id, { requestId: randomUUID(), text });
      await drive(started.run.id);
      const run = await db.agentRun.findUniqueOrThrow({ where: { id: started.run.id } });
      assert.ok(['completed', 'waiting_user'].includes(run.status), `运行状态：${run.status}`);
      return run;
    };
    const first = await execute('我不明白绝对值为什么表示距离。请记住本次讲解要求：只用数轴上的距离举例，暂时不要用代数式。');
    const pack = (await evidencePack({ userId: user.id, conversationId: convo.id, policy }))!;
    assert.ok(pack.items.some((m) => m.kind === 'request' && m.sourceKind === 'student_statement' && JSON.stringify(m.evidence).includes(first.userMessageId!)), '真实GPT应提出带学生原话的讲法要求');
    assert.equal((first.taskFrame as any).memoryWrite.rejected.length, 0);
    const add = (role: 'user' | 'assistant', text: string) => db.message.create({ data: { conversationId: convo.id, subjectId, subjectRevisionId: policy.subjectRevisionId,
      role, content: { blocks: [{ type: 'text', text }], focus: {} } } });
    await add('user', '除了直接看数轴上的距离，还能怎样观察？');
    const method = await add('assistant', '第二种观察办法：把数轴在原点处左右对折，重合的两点到原点距离相同。');
    let last = method;
    for (let i = 0; i < 8; i++) { await add('user', `我在继续观察第${i}组点。`); last = await add('assistant', `已经讨论第${i}组点的位置。`); }
    await db.contextSummary.create({ data: { subjectRevisionId: policy.subjectRevisionId!, scopeKey: summaryScope(policy.subjectRevisionId!, {}, false), version: 1,
      throughMessageId: last.id, throughCreatedAt: last.createdAt, coveredMessages: await db.message.count({ where: { conversationId: convo.id } }),
      body: { notes: [{ kind: 'progress', text: '讨论过绝对值与点的位置。摘要故意不保留讲法要求和对折方法。', refs: [last.id] }] } } });
    const second = await execute('按照我之前的讲解要求，继续解释前面提到的“左右对折”那个办法。请先找回那段原话。');
    const executions = await db.toolExecution.findMany({ where: { runId: second.id, tool: 'readLearningContext', status: 'succeeded' }, orderBy: { createdAt: 'asc' } });
    const modes = executions.map((t) => (t.resultRef as any)?.mode);
    const frame = second.taskFrame as any;
    assert.ok(modes.includes('search'), '摘要漏提后必须实际检索');
    assert.ok(frame.readback.sourceMessageIds.includes(method.id), '必须完整读回被摘要遗漏的方法');
    const text = textOf((await db.message.findFirstOrThrow({ where: { runId: second.id, role: 'assistant', status: 'complete' } })).content);
    assert.match(text, /数轴/); assert.match(text, /对折|重合/); assert.doesNotMatch(text, /\$|坐标公式|设x/);
    const report = { pass: true, realGPT: true, requestExtracted: true, omittedFromSummary: true, searchThenRead: true,
      sources: frame.readback.sourceMessageIds.length, modes, response: text,
      calls: [first, second].flatMap((r) => ((r.counters as any).calls ?? []).map((c: any) => ({ purpose: c.purpose, input: c.inputTokens, output: c.outputTokens }))) };
    await mkdir('.luma/checks', { recursive: true });
    const reportPath = `.luma/checks/memory-live-${Date.now()}.json`;
    await writeFile(reportPath, JSON.stringify({ ...report, firstRunId: first.id, secondRunId: second.id, pack, methodSource: { id: method.id, content: method.content }, frame, executions }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ...report, reportPath }));
  } finally { await db.user.delete({ where: { id: user.id } }); await db.$disconnect(); }
}
main().catch((error) => { console.error(error instanceof assert.AssertionError ? error.message : '真实教学记忆回读验证失败（不输出凭据）'); process.exitCode = 1; });
