import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetContext, ContextBudgetError } from '../src/agent/context';
import { partialRespondText } from '../src/agent/respond-stream';
import { assistantToolCallsMessage, toolResultsMessage } from '../src/agent/protocol';
import { recordFailure, initialCounters, clearFailure, countersFrom, recordUsage } from '../src/agent/limits';

test('预算只移除完整旧轮次，保留当前条件与工具调用结果配对', () => {
  const calls = assistantToolCallsMessage([{ toolCallId: 't', toolName: 'readLearningContext', input: { ref: 'subject' } }]);
  const results = toolResultsMessage([{ toolCallId: 't', toolName: 'readLearningContext', value: { ok: true } }]);
  const current = [{ role: 'user' as const, content: '保留条件 x>0' }, calls, results];
  const r = budgetContext({ system: 'trusted rules', facts: { role: 'user', content: '完整题干' },
    protocol: [{ role: 'user', content: 'old'.repeat(3000) }, { role: 'assistant', content: '旧回复' }, ...current], historyCount: 2, tools: {}, limit: 2000 });
  assert.equal(r.omittedHistory, 2);
  assert.deepEqual(r.messages.slice(1), current);
  assert.ok(r.estimatedInputTokens <= 2000);
});

test('关键事实本身超出预算时拒绝，不静默截断', () => {
  assert.throws(() => budgetContext({ system: 'rules', facts: { role: 'user', content: '关键条件'.repeat(1000) },
    protocol: [{ role: 'user', content: '请给提示' }], historyCount: 0, tools: {}, limit: 2000 }), ContextBudgetError);
});

test('不完整的转义和代理对等待后续分块，其他字段不成为正文', () => {
  assert.equal(partialRespondText('{"disposition":"wait_user","text":"\\uD83D'), '');
  assert.equal(partialRespondText('{"disposition":"wait_user","text":"\\uD83D\\uDCD6'), '📖');
  assert.equal(partialRespondText('{"disposition":"wait_user","text":"a\\'), 'a');
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
