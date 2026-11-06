import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetContext, ContextBudgetError, estimateTokens } from '../src/agent/context';
import { historyPages, historyMatches } from '../src/agent/history';
import { partialRespondText } from '../src/agent/respond-stream';
import { assistantToolCallsMessage, toolResultsMessage } from '../src/agent/protocol';
import { recordFailure, initialCounters, clearFailure, countersFrom, recordUsage } from '../src/agent/limits';

test('最终预算检查不会静默删除历史，保留当前条件与工具调用结果配对', () => {
  const calls = assistantToolCallsMessage([{ toolCallId: 't', toolName: 'readLearningContext', input: { ref: 'subject' } }]);
  const results = toolResultsMessage([{ toolCallId: 't', toolName: 'readLearningContext', value: { ok: true } }]);
  const current = [{ role: 'user' as const, content: '保留条件 x>0' }, calls, results];
  assert.throws(() => budgetContext({ system: 'trusted rules', facts: { role: 'user', content: '完整题干' },
    protocol: [{ role: 'user', content: 'old'.repeat(3000) }, { role: 'assistant', content: '旧回复' }, ...current], historyCount: 2, tools: {}, limit: 2000 }), ContextBudgetError);
  const r = budgetContext({ system: 'trusted rules', facts: { role: 'user', content: '完整题干' }, protocol: current, historyCount: 0, tools: {}, limit: 2000 });
  assert.equal(r.omittedHistory, 0);
  assert.deepEqual(r.messages.slice(1), current);
  assert.ok(r.estimatedInputTokens <= 2000);
});

test('关键事实本身超出预算时拒绝，不静默截断', () => {
  assert.throws(() => budgetContext({ system: 'rules', facts: { role: 'user', content: '关键条件'.repeat(1000) },
    protocol: [{ role: 'user', content: '请给提示' }], historyCount: 0, tools: {}, limit: 2000 }), ContextBudgetError);
});

test('中文按 GPT 编码计量，30轮短对话不会触发300k限制', () => {
  const text = '我还不理解二次函数的对称轴，请换一个例子。';
  assert.ok(estimateTokens(text.repeat(50)) < Buffer.byteLength(text.repeat(50), 'utf8') / 2);
  const protocol = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: `${i}：${text}` }));
  protocol.push({ role: 'user', content: '继续解释刚才的小例子' });
  const result = budgetContext({ system: '规则', facts: { role: 'user', content: '完整题干与带证据的教学进展' }, protocol, historyCount: 60, tools: {}, limit: 300000 });
  assert.equal(result.omittedHistory, 0);
  assert.equal(result.messages.length, 62);
});

test('教学进展、当前问题及工具协议保持完整，最终检查不自行裁剪旧轮次', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: `第${i}条旧讨论：` + '关于二次函数的例子。'.repeat(30) }));
  const facts = { role: 'user' as const, content: '教学进展：学生卡在平方项非负；已用碗底类比。证据 message-old。' };
  const current = [{ role: 'user' as const, content: '请继续解释平方项' }, assistantToolCallsMessage([{ toolCallId: 't2', toolName: 'readLearningContext', input: { ref: 'subject' } }]), toolResultsMessage([{ toolCallId: 't2', toolName: 'readLearningContext', value: { text: '完整条件' } }])];
  const result = budgetContext({ system: '权限规则', facts, protocol: [...history, ...current], historyCount: history.length, tools: {}, limit: 300000 });
  assert.equal(result.omittedHistory, 0);
  assert.match(String(result.messages.at(-4)!.content), /message-old/);
  assert.deepEqual(result.messages.slice(-3), current);
  assert.ok(result.estimatedInputTokens <= 300000);
  assert.equal(history.length, 40);
});

test('历史分页超过100条且不再按12条截断，焦点及解答权限仍隔离', async () => {
  const rows = Array.from({ length: 160 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: { blocks: [{ type: 'text', text: `学生思路${i}` }], focus: {} } }));
  let queries = 0;
  const tx = { message: { findMany: async (q: any) => {
    queries++;
    const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor.id) + q.skip : 0;
    return rows.slice(start, start + q.take);
  } } };
  const messages = [];
  for await (const page of historyPages(tx as any, { conversationId: 'c', subjectId: 's', subjectRevisionId: 'r', focus: {}, allowSolution: false, before: { id: 'new', createdAt: new Date() } })) messages.push(...page);
  assert.equal(queries, 2); assert.equal(messages.length, 160);
  assert.equal(messages[0]!.content, '学生思路0');
  assert.equal(historyMatches({ containsSolution: true }, {}, false), false);
  assert.equal(historyMatches({ focus: { exerciseId: 'e1' } }, { exerciseId: 'e2' }, true), false);
});

test('不完整的转义和代理对等待后续分块，其他字段不成为正文', () => {
  assert.equal(partialRespondText('{"disposition":"wait_user","content":[{"type":"paragraph","text":"\\uD83D'), '');
  assert.equal(partialRespondText('{"disposition":"wait_user","content":[{"type":"paragraph","text":"\\uD83D\\uDCD6'), '📖');
  assert.equal(partialRespondText('{"disposition":"wait_user","content":[{"type":"paragraph","text":"a\\'), 'a');
  assert.equal(partialRespondText('{"refs":[{"text":"不能泄露"}]}'), null);
  assert.equal(partialRespondText('{"text":"乱序时整段降级"}'), null);
});

test('失败计数跨恢复保存，同类失败二次停止，成功后重置；未知用量不伪造为已知', () => {
  const c = initialCounters(); assert.equal(recordFailure(c, 'same-error'), false);
  const restored = countersFrom(JSON.parse(JSON.stringify(c)));
  assert.equal(recordFailure(restored, 'same-error'), true); clearFailure(restored);
  assert.equal(recordFailure(restored, 'same-error'), false);
  recordUsage(restored); assert.equal(restored.unknownUsageCalls, 1);
});
