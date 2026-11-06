import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.LUMA_DEV_FAKE_LOGIN = 'false';
// Exercise the boundary economically; never alter the user's configuration or existing conversations.
const live = process.argv.includes('--live');
process.env.LUMA_MOCK_AGENT = live ? 'false' : 'true';
process.env.CONTEXT_INPUT_TOKENS = '18000';
process.env.CONTEXT_SUMMARY_TOKENS = '1400';

async function main() {
  const { db } = await import('../src/lib/db');
  const { conversationService } = await import('../src/services/conversation.service');
  const { subjectService } = await import('../src/services/subject.service');
  const { runService } = await import('../src/services/run.service');
  const { drive } = await import('../src/agent/loop');
  const { buildPolicy } = await import('../src/agent/policy');
  const { readLearningContext } = await import('../src/agent/tool-executor');
  const { summaryScope, SummaryBody } = await import('../src/agent/compaction');
  const user = await db.user.create({ data: { openid: `dev:context-check-${randomUUID()}` } });
  try {
    const convo = await conversationService.create(user.id, { initialText: '请讲解二次函数的对称轴，使用 y=x² 作例子。', subjectType: 'knowledge' });
    let detail = await conversationService.get(user.id, convo.id);
    const subjectId = detail.subject!.subjectId;
    await subjectService.update(user.id, convo.id, { action: 'confirm', subjectId, expectedRevision: 1 });
    detail = await conversationService.get(user.id, convo.id);
    const revisionId = detail.subject!.id;
    const requirement = await db.message.create({ data: { conversationId: convo.id, subjectId, subjectRevisionId: revisionId,
      role: 'user', createdAt: new Date(Date.now() - 100000), content: { blocks: [{ type: 'text', text: '学习约定：请先用图像解释，再给代数提示。不要先给原题最终答案。' }], focus: {} } } });
    const before = Date.now() - 90000;
    await db.message.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ conversationId: convo.id, subjectId, subjectRevisionId: revisionId,
      role: i % 2 ? 'assistant' as const : 'user' as const, createdAt: new Date(before + i * 1000),
      content: { blocks: [{ type: 'text', text: `第${i + 1}条教学记录。` + (i % 2 ? '观察y=x²图像左右两侧：相反的横坐标会得到同样高度的点，折叠后两侧可以重合。请比较横坐标1与-1、2与-2两组点，再观察镜像关系。' : '我可以找到图像左右两侧同高度的点，但还想知道用图像的对折关系怎样帮助理解对称轴。这里讨论的是同一个函数y=x²，没有增加新的题目条件。').repeat(5) }], focus: {}, containsSolution: false } })) });
    const totalMessages = await db.message.count({ where: { conversationId: convo.id } });
    const execute = async (text: string) => {
      const started = await runService.startRun(user.id, convo.id, { requestId: randomUUID(), text });
      await drive(started.run.id);
      const result = await db.agentRun.findUniqueOrThrow({ where: { id: started.run.id } });
      assert.ok(['completed', 'waiting_user'].includes(result.status), `运行未结束：${JSON.stringify(result.error)}`);
      return result;
    };
    const run = await execute('请延续之前的讨论，先照顾我的学习约定，再用一句话提示我该怎样观察对称轴。');
    const scopeKey = summaryScope(revisionId, {}, false);
    const summary = await db.contextSummary.findUniqueOrThrow({ where: { subjectRevisionId_scopeKey: { subjectRevisionId: revisionId, scopeKey } } });
    const body = SummaryBody.parse(summary.body);
    assert.ok(summary.coveredMessages > 0);
    assert.ok((run.counters as any).modelRequests.context_summary > 0);
    if (live) assert.ok(body.notes.some((n) => n.refs.includes(requirement.id) && n.quote?.includes('图像')), '真实摘要必须保留学生的早期要求与引用');
    const policy = await buildPolicy({ conversationId: convo.id, subjectId });
    const raw = await readLearningContext({ userId: user.id, conversationId: convo.id, policy }, { ref: 'messages', messageIds: [requirement.id] }) as any;
    assert.equal(raw.ok, true); assert.ok(raw.messages[0].text.includes('先用图像'));
    const second = await execute('我理解镜像关系了，请继续用图像引导。');
    const restored = await db.contextSummary.findUniqueOrThrow({ where: { id: summary.id } });
    assert.equal(restored.version, summary.version, '下一轮不应重复摘要已覆盖的记录');
    assert.equal((second.counters as any).modelRequests.context_summary ?? 0, 0);
    assert.ok(await db.message.count({ where: { conversationId: convo.id } }) >= totalMessages + 4, '压缩不能删除原消息');
    assert.equal(await db.contextSummary.count({ where: { subjectRevisionId: revisionId, scopeKey: summaryScope(revisionId, {}, true) } }), 0);
    await subjectService.update(user.id, convo.id, { action: 'update', subjectId, expectedRevision: 1, content: { text: '新内容：一次函数。' } });
    const updated = await conversationService.get(user.id, convo.id);
    assert.equal(await db.contextSummary.count({ where: { subjectRevisionId: updated.subject!.id } }), 0);
    console.log(JSON.stringify({ pass: true, model: live ? 'real GPT' : 'mock', threshold: '80%', testWindow: 18000,
      summaryVersion: summary.version, coveredMessages: summary.coveredMessages, nextTurnReused: true, sourceReadback: true,
      inputTokens: (run.policySnapshot as any)?.estimatedInputTokens,
      calls: ((run.counters as any).calls ?? []).map((c: any) => ({ purpose: c.purpose, input: c.inputTokens, output: c.outputTokens, cachedInput: c.cachedInputTokens ?? null })) }));
  } finally { await db.user.delete({ where: { id: user.id } }); await db.$disconnect(); }
}
main().catch((error) => { console.error('FAIL 长会话检查：', error instanceof assert.AssertionError ? error.message : '检查本地服务或摘要运行状态，不输出凭据'); process.exitCode = 1; });
