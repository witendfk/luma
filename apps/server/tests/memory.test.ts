import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryOperation, memoryScopeKey, memoryVisible, memoryStatus } from '../src/agent/teaching-memory';
import { MessageReadOptions, boundedRead, normalizeHistoryQuery } from '../src/agent/history-reader';
import { initialReadback, observeReadback, validateReadback } from '../src/agent/readback';
import type { TurnPolicy } from '../src/agent/policy';
import type { TaskFrame } from '../src/agent/types';

const policy: TurnPolicy = { subjectId: 's', subjectRevisionId: 'r', stage: 'guiding', subjectConfirmed: true,
  allowedTools: [], allowSolution: false, answerPermission: false, focus: {} };
test('记忆范围稳定且区分材料版本；对象要求可进入段落，原题卡点不进入练习', () => {
  assert.equal(memoryScopeKey({ sectionId: 's', artifactId: 'a' }), memoryScopeKey({ artifactId: 'a', sectionId: 's' }));
  assert.notEqual(memoryScopeKey({ artifactId: 'a', artifactVersion: 1 }), memoryScopeKey({ artifactId: 'a', artifactVersion: 2 }));
  const note = { scope: {}, kind: 'request', containsSolution: false, status: 'active' };
  assert.ok(memoryVisible(note, { ...policy, focus: { artifactId: 'a', sectionId: 's' } }));
  assert.ok(memoryVisible(note, { ...policy, focus: { attemptId: 'p', exerciseId: 'e' } }));
  assert.equal(memoryVisible({ ...note, kind: 'difficulty' }, { ...policy, focus: { attemptId: 'p', exerciseId: 'e' } }), false);
  assert.equal(memoryVisible({ ...note, status: 'resolved' }, policy), false);
  assert.equal(memoryVisible({ ...note, containsSolution: true }, policy), false);
  assert.equal(memoryVisible({ ...note, scope: { artifactId: 'a', artifactVersion: 1 } }, { ...policy, focus: { artifactId: 'a', artifactVersion: 2 } }), false);
});
test('错误尝试与模型推测不是核验事实；更正需要条目ID、版本和学生原话', () => {
  assert.equal(memoryStatus('attempt', 'student', 'add'), 'candidate');
  assert.equal(memoryStatus('method', 'assistant', 'add'), 'candidate');
  assert.equal(memoryStatus('constraint', 'student', 'supersede'), 'conflicted');
  assert.equal(memoryStatus('request', 'student', 'add'), 'active');
  assert.throws(() => MemoryOperation.parse({ action: 'add', kind: 'request', text: '越权更正', targetId: 'm', expectedVersion: 1, source: 'student', quote: '改一下' }));
  assert.throws(() => MemoryOperation.parse({ action: 'resolve', kind: 'difficulty', source: 'student', quote: '懂了' }));
  assert.throws(() => MemoryOperation.parse({ action: 'resolve', kind: 'difficulty', targetId: 'm', expectedVersion: 1, source: 'assistant', quote: '学生懂了' }));
});
test('中文数学字面定位不执行正则，读取模式互斥', () => {
  assert.equal(normalizeHistoryQuery('$x^2 − 4x$'), normalizeHistoryQuery('x²-4x'));
  assert.equal(normalizeHistoryQuery('\\left( x \\right)'), '(x)');
  assert.ok(MessageReadOptions.safeParse({ query: '只用图像' }).success);
  for (const input of [{ query: 'a', messageIds: ['m'] }, { aroundMessageId: 'm', beforeMessageId: 'n' }, { offset: 10 }, { query: 'a'.repeat(121) }]) assert.equal(MessageReadOptions.safeParse(input).success, false);
});
test('原文读取有独立预算及续读位置，不把片段标成已完整读取', () => {
  const messages = [{ id: 'm', role: 'user', createdAt: new Date(), content: { blocks: [{ type: 'text', text: '数轴与距离📖'.repeat(1000) }] } }] as any;
  const result = boundedRead(messages, 0, 100);
  assert.equal(result.truncated, true); assert.equal(result.messages[0]!.complete, false);
  assert.equal(result.nextRead!.offset, result.messages[0]!.text.length);
  assert.ok(!/[\uD800-\uDBFF]$/.test(result.messages[0]!.text));
});
test('历史搜索索引不满足回读；完整原文或明确澄清才解除门槛', () => {
  assert.equal(initialReadback('我之前没有学过绝对值', 'new'), undefined);
  const frame: TaskFrame = { kind: 'chat', goals: [], readback: initialReadback('前面第二种方法是什么', 'trigger') };
  observeReadback(frame, [{ toolName: 'readLearningContext', value: { ok: true, mode: 'search', hits: [{ id: 'm' }] } }]);
  assert.equal(frame.readback!.status, 'pending');
  assert.equal(validateReadback(frame, { disposition: 'finish', text: '我猜是配方' })!.ok, false);
  observeReadback(frame, [{ toolName: 'readLearningContext', value: { ok: true, messages: [{ id: 'trigger', text: '自己', complete: true }, { id: 'wrong', text: '其他', complete: true }] } }]);
  assert.equal(frame.readback!.status, 'pending');
  observeReadback(frame, [{ toolName: 'readLearningContext', value: { ok: true, messages: [{ id: 'm', text: '原文', complete: true }] } }]);
  assert.equal(frame.readback!.status, 'read');
  const absent: TaskFrame = { kind: 'chat', goals: [], readback: initialReadback('前面那个方法', 't') };
  assert.equal(validateReadback(absent, { disposition: 'wait_user', text: '你指图像法还是配方法？', clarification: { reason: 'history_ambiguous', question: '你指图像法还是配方法？' } }), null);
  assert.equal(absent.readback!.status, 'clarified');
});
test('续读必须连续，题干更正不能被普通历史读取解除', () => {
  const frame: TaskFrame = { kind: 'chat', goals: [], readback: initialReadback('前面的要求', 't') };
  const send = (offset: number, text: string, complete: boolean) => observeReadback(frame, [{ toolName: 'readLearningContext', value: { ok: true, messages: [{ id: 'm', offset, text, complete }] } }]);
  send(3, '尾部', true); assert.equal(frame.readback!.status, 'pending');
  send(0, 'abc', false); assert.equal(frame.readback!.status, 'pending');
  send(3, '尾部', true); assert.equal(frame.readback!.status, 'read');
  frame.conditionCorrection = true;
  assert.equal(validateReadback(frame, { disposition: 'finish', text: '接着算' })!.ok, false);
  assert.equal(validateReadback(frame, { disposition: 'wait_user', text: '请先修改核对题干。', clarification: { reason: 'subject_correction', question: '请先修改核对题干。' } }), null);
});
