import assert from 'node:assert/strict';
import test from 'node:test';
import { countersFrom, initialCounters, ModelBudgetError, modelBudgetTotals, reserveModelRequest, settleModelRequest } from '../src/agent/limits';
import { aggregateJobUsage } from '../src/lib/model-accounting';

process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
delete process.env.OPENAI_BASE_URL;
const limits = { requests: 4, tokens: 1000 };

test('调用前包含本次输入和允许输出，额度不足不增加次数或预留', () => {
  const c = initialCounters();
  reserveModelRequest(c, 'agent', 600, 300, limits);
  const before = JSON.stringify(c);
  assert.throws(() => reserveModelRequest(c, 'agent', 70, 40, limits), ModelBudgetError);
  assert.equal(JSON.stringify(c), before);
  reserveModelRequest(c, 'context_summary', 70, 30, limits);
  assert.deepEqual(modelBudgetTotals(c), { requests: 2, tokens: 1000 });
});

test('真实用量替换预留且只结算一次，缓存输入仍计入完整预算', () => {
  const c = initialCounters(), id = reserveModelRequest(c, 'agent', 600, 300, limits);
  assert.equal(settleModelRequest(c, id, { inputTokens: 500, outputTokens: 100, cachedInputTokens: 400 }), true);
  assert.deepEqual(modelBudgetTotals(c), { requests: 1, tokens: 600 });
  assert.equal(c.tokens.cachedInput, 400);
  assert.equal(settleModelRequest(c, id, { inputTokens: 1, outputTokens: 1 }), false);
  assert.deepEqual(modelBudgetTotals(c), { requests: 1, tokens: 600 });
  // Actual usage can exceed an estimate; never clamp away that overrun.
  const next = reserveModelRequest(c, 'agent', 100, 100, limits);
  settleModelRequest(c, next, { inputTokens: 350, outputTokens: 120 });
  assert.equal(modelBudgetTotals(c).tokens, 1070);
  assert.throws(() => reserveModelRequest(c, 'agent', 0, 0, limits), ModelBudgetError);
});

test('半已知/未知/进程中断用量跨恢复保守保留，不伪造为零或重复累加', () => {
  const c = initialCounters(), partial = reserveModelRequest(c, 'agent', 600, 300, limits);
  settleModelRequest(c, partial, { inputTokens: 500 });
  assert.equal(c.unknownUsageCalls, 1); assert.equal(modelBudgetTotals(c).tokens, 800);
  const restored = countersFrom(JSON.parse(JSON.stringify(c)));
  assert.equal(modelBudgetTotals(restored).tokens, 800);
  const pending = reserveModelRequest(restored, 'context_summary', 100, 100, limits);
  const recovered = countersFrom(JSON.parse(JSON.stringify(restored)));
  assert.equal(recovered.modelReservations[pending]!.status, 'pending');
  assert.equal(modelBudgetTotals(recovered).tokens, 1000);
  assert.throws(() => reserveModelRequest(recovered, 'agent', 1, 1, limits), ModelBudgetError);
  settleModelRequest(recovered, pending);
  assert.equal(modelBudgetTotals(recovered).tokens, 1000);
});

test('后台预留和真实用量并入前台累计；并发任务不各拿一份独立预算', () => {
  const job = initialCounters(), id = reserveModelRequest(job, 'lesson_body', 500, 200, limits);
  const parent = initialCounters();
  parent.background = aggregateJobUsage([{ counters: job }]);
  assert.equal(modelBudgetTotals(parent).tokens, 700);
  assert.throws(() => reserveModelRequest(parent, 'agent', 250, 100, limits), ModelBudgetError);
  settleModelRequest(job, id, { inputTokens: 350, outputTokens: 100 });
  parent.background = aggregateJobUsage([{ counters: job }]);
  assert.equal(modelBudgetTotals(parent).tokens, 450);
  reserveModelRequest(parent, 'agent', 400, 150, limits);
  assert.equal(modelBudgetTotals(parent).tokens, 1000);
});

test('旧检查点未知请求恢复为保守占用，已知完整用量不重复预留', () => {
  const legacy = { ...initialCounters(), modelReservations: undefined, modelRequests: { agent: 2 }, unknownUsageCalls: 1,
    calls: [{ purpose: 'agent', model: 'test', attempt: 1, durationMs: 1, inputTokens: 10, outputTokens: 10 }], tokens: { input: 10, output: 10 } };
  const restored = countersFrom(legacy);
  assert.ok(modelBudgetTotals(restored).tokens > 20);
  assert.equal(modelBudgetTotals(countersFrom(JSON.parse(JSON.stringify(restored)))).tokens, modelBudgetTotals(restored).tokens);
  const known = countersFrom({ ...legacy, modelRequests: { agent: 1 }, unknownUsageCalls: 0 });
  assert.equal(modelBudgetTotals(known).tokens, 20);
});

test('请求数独立限制，非法估算或用量不能释放额度', () => {
  const c = initialCounters(), id = reserveModelRequest(c, 'agent', 100, 100, { requests: 1, tokens: 1000 });
  assert.throws(() => reserveModelRequest(c, 'agent', 0, 0, { requests: 1, tokens: 1000 }), ModelBudgetError);
  settleModelRequest(c, id, { inputTokens: NaN, outputTokens: -1 });
  assert.equal(modelBudgetTotals(c).tokens, 200);
  assert.equal(c.unknownUsageCalls, 1);
  assert.throws(() => reserveModelRequest(c, 'agent', NaN, 100, limits), /预留额度无效/);
});
