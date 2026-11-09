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
  const { memoryScopeKey } = await import('../src/agent/teaching-memory');
  const { readHistoricalToolResult } = await import('../src/agent/tool-result-memory');
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
    const audits = await db.toolExecution.findMany({ where: { runId: run.id, tool: 'contextSummaryCheckpoint' }, orderBy: { createdAt: 'asc' } });
    assert.equal(audits.length, summary.version);
    const coveredUserIds = audits.flatMap((audit) => (audit.resultRef as any).coverage.map((c: any) => c.messageId));
    const expectedUsers = await db.message.findMany({ where: { conversationId: convo.id, subjectRevisionId: revisionId, role: 'user',
      OR: [{ createdAt: { lt: summary.throughCreatedAt } }, { createdAt: summary.throughCreatedAt, id: { lte: summary.throughMessageId } }] }, select: { id: true } });
    assert.deepEqual([...coveredUserIds].sort(), expectedUsers.map((m) => m.id).sort(), '每条被压缩的学生消息都有独立审计');
    const recent = await db.message.findMany({ where: { conversationId: convo.id, subjectRevisionId: revisionId,
      role: 'user', id: { not: run.userMessageId! } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 3 });
    assert.ok(recent.every((m) => m.createdAt > summary.throughCreatedAt), '最近三轮不进入覆盖游标');
    if (live) assert.ok(body.notes.some((n) => n.refs.includes(requirement.id) && n.quote?.includes('图像')), '真实摘要必须保留学生的早期要求与引用');
    const policy = await buildPolicy({ conversationId: convo.id, subjectId });
    const raw = await readLearningContext({ userId: user.id, conversationId: convo.id, policy }, { ref: 'messages', messageIds: [requirement.id] }) as any;
    assert.equal(raw.ok, true); assert.ok(raw.messages[0].text.includes('先用图像'));
    // Isolated lifecycle fixture: a resolved quote and another still-effective quote share one message.
    if (!live) {
      await db.teachingMemory.create({ data: { subjectRevisionId: revisionId, scope: {}, scopeKey: memoryScopeKey({}), kind: 'request',
        text: '旧讲法已解决', sourceKind: 'student_statement', status: 'resolved',
        evidence: [{ messageId: requirement.id, quote: '请先用图像解释', role: 'user' }] } });
      await db.contextSummary.update({ where: { id: summary.id }, data: { body: { notes: [...body.notes,
        { kind: 'request', text: '已失效讲法', refs: [requirement.id], quote: '请先用图像解释' },
        { kind: 'request', text: '仍保留的要求', refs: [requirement.id], quote: '不要先给原题最终答案' }] } } });
    }
    const sourceValue = await readLearningContext({ userId: user.id, conversationId: convo.id, policy }, { ref: 'subject' });
    const readExecution = await db.toolExecution.create({ data: { runId: run.id, decisionId: 'offline-read-fixture', toolCallId: 'offline-read-fixture',
      tool: 'readLearningContext', batchOrder: 0, status: 'succeeded', paramsDigest: { input: { ref: 'subject' } }, resultRef: sourceValue as any } });
    const recovered = await readHistoricalToolResult({ userId: user.id, conversationId: convo.id, policy }, readExecution.id) as any;
    assert.equal(recovered.ok, true); assert.deepEqual(JSON.parse(recovered.text), sourceValue);
    const denied = await readHistoricalToolResult({ userId: 'different-user', conversationId: convo.id, policy }, readExecution.id) as any;
    assert.equal(denied.code, 'NOT_FOUND');
    const second = await execute('我理解镜像关系了，请继续用图像引导。');
    const restored = await db.contextSummary.findUniqueOrThrow({ where: { id: summary.id } });
    assert.equal(restored.version, summary.version, '下一轮不应重复摘要已覆盖的记录');
    assert.equal((second.counters as any).modelRequests.context_summary ?? 0, 0);
    if (!live) {
      const projected = JSON.stringify(second.protocol);
      assert.ok(!projected.includes('已失效讲法'));
      assert.ok(projected.includes('仍保留的要求'));
      const writeReceipt = await db.toolExecution.create({ data: { runId: run.id, decisionId: 'offline-write-fixture', toolCallId: 'offline-write-fixture',
        tool: 'createLesson', batchOrder: 0, status: 'succeeded', resultRef: { ok: true } } });
      assert.equal((await readHistoricalToolResult({ userId: user.id, conversationId: convo.id, policy }, writeReceipt.id) as any).code, 'NOT_FOUND');
      const artifact = await db.artifact.create({ data: { conversationId: convo.id, subjectRevisionId: revisionId, type: 'lesson',
        version: 1, publishStatus: 'published', content: {} } });
      const snapshot = await db.toolExecution.create({ data: { runId: run.id, decisionId: 'offline-artifact-fixture', toolCallId: 'offline-artifact-fixture',
        tool: 'readLearningContext', batchOrder: 0, status: 'succeeded', paramsDigest: { input: { ref: 'artifacts' } },
        resultRef: { ok: true, artifactId: artifact.id, version: 1 } } });
      await db.artifact.update({ where: { id: artifact.id }, data: { version: 2 } });
      assert.equal((await readHistoricalToolResult({ userId: user.id, conversationId: convo.id, policy }, snapshot.id) as any).code, 'STALE_REFERENCE');
      // Compatibility with an old checkpoint that had already covered the newest user rounds.
      const tail = await db.message.findFirstOrThrow({ where: { conversationId: convo.id, role: 'assistant', status: 'complete' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      await db.contextSummary.update({ where: { id: summary.id }, data: { throughMessageId: tail.id, throughCreatedAt: tail.createdAt } });
      const rebuilt = await execute('继续讨论对称轴的图像意义。');
      const fixed = await db.contextSummary.findUniqueOrThrow({ where: { id: summary.id } });
      assert.ok(fixed.version > summary.version, '重建保持CAS版本单调递增');
      assert.ok(fixed.throughCreatedAt < tail.createdAt, '旧游标吞掉近期轮次时，从原文重建');
      assert.ok((rebuilt.counters as any).modelRequests.context_summary > 0);
    }
    assert.ok(await db.message.count({ where: { conversationId: convo.id } }) >= totalMessages + 4, '压缩不能删除原消息');
    assert.equal(await db.contextSummary.count({ where: { subjectRevisionId: revisionId, scopeKey: summaryScope(revisionId, {}, true) } }), 0);
    await subjectService.update(user.id, convo.id, { action: 'update', subjectId, expectedRevision: 1, content: { text: '新内容：一次函数。' } });
    const updated = await conversationService.get(user.id, convo.id);
    assert.equal(await db.contextSummary.count({ where: { subjectRevisionId: updated.subject!.id } }), 0);
    const revisedPolicy = await buildPolicy({ conversationId: convo.id, subjectId });
    assert.equal((await readHistoricalToolResult({ userId: user.id, conversationId: convo.id, policy: revisedPolicy }, readExecution.id) as any).code, 'NOT_FOUND');
    console.log(JSON.stringify({ pass: true, model: live ? 'real GPT' : 'mock', threshold: '80%', testWindow: 18000,
      summaryVersion: summary.version, coveredMessages: summary.coveredMessages, nextTurnReused: true, sourceReadback: true,
      coverageAudit: true, recentThreeProtected: true, toolSnapshotReadback: true, noWriteReplay: !live, retiredQuoteAndLegacyCursor: !live,
      inputTokens: (run.policySnapshot as any)?.estimatedInputTokens,
      calls: ((run.counters as any).calls ?? []).map((c: any) => ({ purpose: c.purpose, input: c.inputTokens, output: c.outputTokens, cachedInput: c.cachedInputTokens ?? null })) }));
  } finally { await db.user.delete({ where: { id: user.id } }); await db.$disconnect(); }
}
main().catch((error) => { console.error('FAIL 长会话检查：', error instanceof assert.AssertionError ? error.message : '检查本地服务或摘要运行状态，不输出凭据'); process.exitCode = 1; });
