import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedToolResult, recoverableRead, readHistoricalToolResult, historicalReadResults } from '../src/agent/tool-result-memory';
import type { TurnPolicy } from '../src/agent/policy';

const policy: TurnPolicy = { subjectId: 's', subjectRevisionId: 'r', stage: 'guiding', subjectConfirmed: true,
  allowedTools: ['readLearningContext'], allowSolution: false, answerPermission: false, focus: {} };
const saved = () => ({ id: 'execution', status: 'succeeded', tool: 'readLearningContext', paramsDigest: { input: { ref: 'messages' } },
  resultRef: { ok: true, mode: 'read', messages: [{ id: 'm1', text: '只先看图像' }] },
  run: { id: 'oldRun', subjectRevisionId: 'r', policySnapshot: policy } });

test('只恢复完成的纯读取，禁止失败、写操作、attempt副作用和跨焦点/解析权限', () => {
  assert.equal(recoverableRead(saved(), policy), true);
  for (const bad of [
    { ...saved(), status: 'failed' }, { ...saved(), tool: 'createLesson' },
    { ...saved(), resultRef: { ok: false } },
    { ...saved(), paramsDigest: { input: { ref: 'attempt' } } },
    { ...saved(), paramsDigest: { input: { ref: 'tool_result' } } },
    { ...saved(), run: { ...saved().run, subjectRevisionId: 'other' } },
    ...[{ ...policy, allowSolution: true }, { ...policy, answerPermission: true }, { ...policy, focus: { sectionId: 'other' } }]
      .map((source) => ({ ...saved(), run: { ...saved().run, policySnapshot: source } })),
  ]) assert.equal(recoverableRead(bad, policy), false);
});

test('大结果以明确JSON分块续读，重组保留中文、公式和emoji且不截断伪装完整', () => {
  const value = { ok: true, text: '条件$x>0$，🙂先看图。'.repeat(100) };
  let offset = 0, text = '', parts = 0;
  for (;;) {
    const result = boundedToolResult(value, offset, 180);
    assert.equal(result.ok, true);
    if (!('text' in result)) throw new Error('读取失败');
    text += result.text; parts++;
    if (result.complete) { assert.equal(result.nextOffset, null); break; }
    assert.ok(result.nextOffset! > offset); offset = result.nextOffset!;
  }
  assert.ok(parts > 1); assert.deepEqual(JSON.parse(text), value);
  assert.equal(boundedToolResult(value, -1).ok, false);
});

test('回读仅取原执行快照，核对归属/版本/焦点；不会调用工具或数据库写方法', async () => {
  const row = saved();
  let reads = 0;
  const tx = { toolExecution: { findFirst: async (q: any) => {
    reads++;
    assert.equal(q.where.run.conversation.userId, 'u');
    assert.equal(q.where.run.conversationId, 'c');
    assert.equal(q.where.run.subjectRevisionId, 'r');
    return row;
  } }, message: { findMany: async () => [{ id: 'm1', content: { focus: {} } }] } };
  const ctx = { userId: 'u', conversationId: 'c', policy };
  const result = await readHistoricalToolResult(ctx, row.id, 0, tx as any) as any;
  assert.equal(result.ok, true); assert.deepEqual(JSON.parse(result.text), row.resultRef); assert.equal(reads, 1);
  tx.message.findMany = async () => [];
  assert.equal((await readHistoricalToolResult(ctx, row.id, 0, tx as any) as any).code, 'STALE_REFERENCE');
});

test('材料版本变更则目录与回读都拒绝旧快照；当前轮/未来轮不进入历史查询', async () => {
  const row = { ...saved(), paramsDigest: { input: { ref: 'artifacts' } }, resultRef: { ok: true, artifactId: 'a', version: 1 } };
  const boundary = { id: 'currentUser', createdAt: new Date() };
  const query = (q: any) => {
    assert.equal(q.where.runId.not, 'currentRun');
    assert.equal(q.where.run.userMessage.OR[0].createdAt.lt, boundary.createdAt);
  };
  const tx = { agentRun: { findFirst: async () => ({ userMessage: boundary }) },
    toolExecution: { findFirst: async (q: any) => { query(q); return row; }, findMany: async (q: any) => { query(q); return [row]; } },
    artifact: { findFirst: async (q: any) => { assert.equal(q.where.version, 1); return null; } } };
  const ctx = { userId: 'u', conversationId: 'c', runId: 'currentRun', policy };
  assert.equal((await readHistoricalToolResult(ctx, row.id, 0, tx as any) as any).code, 'STALE_REFERENCE');
  assert.deepEqual((await historicalReadResults(ctx, tx as any)).refs, []);
});
