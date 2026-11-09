import assert from 'node:assert/strict';
import test from 'node:test';
import { compactHistory, mergeSummary, protectedHistoryStart, retireSummaryNotes, validateSummaryCoverage, summaryScope, type HistoryRow, type SummaryCheckpoint } from '../src/agent/compaction';
import { ResultCache } from '../src/lib/result-cache';
import { initialCounters, recordUsage } from '../src/agent/limits';
import { modelUsage } from '../src/lib/model';

const row = (i: number): HistoryRow => ({ id: `m${i}`, createdAt: new Date(i * 1000), role: i % 2 ? 'assistant' : 'user',
  content: i === 0 ? '约定：请先用图像解释。条件 $x>0$。' : `第${i}条讨论：` + '对称轴两侧同高度点互为镜像。'.repeat(10) });
async function* pages(rows: HistoryRow[]) { for (let i = 0; i < rows.length; i += 10) yield rows.slice(i, i + 10); }
const coverage = (rows: HistoryRow[]) => rows.filter((r) => r.role === 'user').map((r) => ({ messageId: r.id,
  disposition: 'process', refs: [r.id], reason: '一般过程' }));

test('80%阈值触发真实摘要替换流程，多次合并保留逐字条件/来源并可跨轮恢复', async () => {
  let saved: SummaryCheckpoint | null = null, calls = 0;
  const summarize = async (previous: any, selected: HistoryRow[]) => {
    calls++;
    return { coverage: coverage(selected), notes: [
      ...(selected.some((r) => r.id === 'm0') ? [{ kind: 'request', text: '学生要求先看图，条件为正数', refs: ['m0'], quote: '约定：请先用图像解释。条件 $x>0$。' }] : []),
      { kind: 'progress', text: '已讨论两侧镜像关系', refs: [selected.at(-1)!.id] },
    ] };
  };
  const save = async (next: SummaryCheckpoint, expected: number) => {
    assert.equal(expected, saved?.version ?? 0); saved = next;
  };
  const input = { fixedTokens: 500, inputLimit: 4000, outputReserve: 300, ratio: 0.8, summaryTokens: 400, summarize, save };
  const first = await compactHistory({ ...input, protectedFrom: row(94), pages: pages(Array.from({ length: 100 }, (_, i) => row(i))), previous: null });
  assert.ok(calls > 1, '需要实际多次合并，不能只截断旧历史');
  assert.ok(first.checkpoint!.body.notes.some((n) => n.quote?.includes('$x>0$') && n.refs.includes('m0')));
  assert.equal(first.checkpoint!.coveredMessages + first.rows.length, 100);
  assert.equal(first.rows[0]!.role, 'user');
  const savedCalls = calls;
  const restored = await compactHistory({ ...input, protectedFrom: row(94), previous: first.checkpoint, pages: pages(first.rows) });
  assert.equal(calls, savedCalls, '未到阈值不重复摘要已覆盖消息');
  assert.deepEqual(restored.checkpoint, first.checkpoint);
  const second = await compactHistory({ ...input, protectedFrom: row(144), previous: restored.checkpoint,
    pages: pages([...restored.rows, ...Array.from({ length: 50 }, (_, i) => row(100 + i))]) });
  assert.ok(second.checkpoint!.version > first.checkpoint!.version);
  assert.ok(second.checkpoint!.body.notes.some((n) => n.quote?.includes('$x>0$')));
  assert.equal(second.checkpoint!.coveredMessages + second.rows.length, 150);
});

test('摘要失败、伪造引用或改写逐字公式不得推进覆盖游标', async () => {
  let saves = 0;
  for (const summarize of [async () => { throw new Error('offline'); }, async () => ({ notes: [{ kind: 'request', text: '错引用', refs: ['other-user'], quote: '原文' }] })]) {
    await assert.rejects(compactHistory({ protectedFrom: row(24), pages: pages(Array.from({ length: 30 }, (_, i) => row(i))), previous: null,
      fixedTokens: 500, inputLimit: 4000, outputReserve: 300, ratio: 0.8, summaryTokens: 400, summarize,
      save: async () => { saves++; } }));
  }
  assert.equal(saves, 0);
  assert.throws(() => mergeSummary({ notes: [{ kind: 'constraint', text: '条件', refs: ['m0'], quote: '$x<0$' }] }, null, [row(0)], 1000), /原文不符/);
});

test('取消或版本冲突导致摘要保存失败时不继续推理，也不移除原文', async () => {
  const originals = Array.from({ length: 30 }, (_, i) => row(i));
  let attempted = 0;
  await assert.rejects(compactHistory({ protectedFrom: row(24), pages: pages(originals), previous: null,
    fixedTokens: 500, inputLimit: 4000, outputReserve: 300, ratio: 0.8, summaryTokens: 400,
    summarize: async (_p, rows) => ({ coverage: coverage(rows), notes: [{ kind: 'progress', text: '旧讨论', refs: [rows[0]!.id] }] }),
    save: async () => { attempted++; throw new Error('执行已取消或版本已更新'); } }), /已取消/);
  assert.equal(attempted, 1); assert.equal(originals.length, 30);
});

test('同一关键引用再次提炼时不重复累加，预算容不下时拒绝丢弃关键原文', () => {
  const note = { kind: 'constraint' as const, text: '原条件', refs: ['m0'], quote: '$x>0$' };
  const next = mergeSummary({ notes: [{ ...note, text: '仍需遵守的条件' }] }, { notes: [note] }, [], 1000);
  assert.equal(next.notes.length, 1); assert.equal(next.notes[0]!.text, '仍需遵守的条件');
  assert.throws(() => mergeSummary({ notes: [{ ...note, text: '长'.repeat(600), quote: '长'.repeat(1600) }] }, null,
    [{ ...row(0), content: '长'.repeat(1600) }], 100), /超出压缩预算/);
});

test('没有正式解决证据的旧未解问题不能在重摘要中消失', () => {
  const note = { kind: 'open_question' as const, text: '为什么平方项非负？', refs: ['m0'] };
  const next = mergeSummary({ notes: [] }, { notes: [note] }, [], 1000);
  assert.deepEqual(next.notes, [note]);
});

test('摘要按对象版本、材料段落、练习轮次及解析权限隔离', () => {
  const original = summaryScope('r1', { artifactId: 'a', artifactVersion: 1, sectionId: 's1' }, false);
  for (const scope of [summaryScope('r2', { artifactId: 'a', sectionId: 's1' }, false), summaryScope('r1', { artifactId: 'a', artifactVersion: 1, sectionId: 's2' }, false),
    summaryScope('r1', { artifactId: 'a', artifactVersion: 1, sectionId: 's1' }, true), summaryScope('r1', { attemptId: 'p2', exerciseId: 'e' }, false)]) assert.notEqual(original, scope);
});

test('倒序跨页定位最近三完整轮，末尾未回复的提问也保留；不足三轮不摘要', async () => {
  const wideRounds = Array.from({ length: 40 }, (_, i) => ({ ...row(i), role: i % 12 === 0 ? 'user' as const : 'assistant' as const }));
  assert.equal((await protectedHistoryStart(pages([...wideRounds].reverse())))?.id, 'm12', '每轮多条回复时跨越多个倒序页面');
  const history = Array.from({ length: 29 }, (_, i) => row(i));
  const start = await protectedHistoryStart(pages([...history].reverse()));
  assert.equal(start?.id, 'm22');
  assert.equal(await protectedHistoryStart(pages(history.slice(0, 5).reverse())), null);
  let saved = 0;
  const r = await compactHistory({ pages: pages(history), previous: null, protectedFrom: start,
    fixedTokens: 500, inputLimit: 4000, outputReserve: 300, ratio: 0.8, summaryTokens: 400,
    summarize: async (_p, selected) => {
      assert.ok(selected.every((r) => r.createdAt < row(22).createdAt));
      assert.equal(selected[0]!.role, 'user');
      assert.equal(selected.at(-1)!.role, 'assistant', '不压掉半个用户轮次');
      return { coverage: coverage(selected), notes: [{ kind: 'progress', text: '旧讨论', refs: [selected[0]!.id] }] };
    }, save: async (_next, _version, audit) => { saved++; assert.ok(audit.coverage.length); } });
  assert.ok(saved > 0);
  assert.deepEqual(r.rows.slice(-7), history.slice(-7));
});

test('缺失覆盖清单或复活明确失效原话都不能保存摘要游标', async () => {
  let saves = 0;
  for (const mode of ['missing', 'retired']) {
    await assert.rejects(compactHistory({ pages: pages(Array.from({ length: 30 }, (_, i) => row(i))), previous: null,
      protectedFrom: row(24), retired: [{ memoryId: 'mem0', messageId: 'm0', quote: '请先用图像解释', status: 'superseded' }],
      fixedTokens: 500, inputLimit: 4000, outputReserve: 300, ratio: 0.8, summaryTokens: 400,
      summarize: async (_p, rows) => ({ ...(mode === 'retired' ? { coverage: coverage(rows) } : {}), notes: mode === 'retired'
        ? [{ kind: 'request', text: '复活旧要求', refs: ['m0'], quote: '请先用图像解释' }]
        : [{ kind: 'progress', text: '没有覆盖记录', refs: [rows[0]!.id] }] }),
      save: async () => { saves++; } }), /来源或容量校验/);
  }
  assert.equal(saves, 0);
});

test('最近三轮保护优先于阈值，必要内容过大时停止且不调用摘要', async () => {
  let calls = 0;
  await assert.rejects(compactHistory({ pages: pages(Array.from({ length: 6 }, (_, i) => row(i))), previous: null,
    protectedFrom: row(0), fixedTokens: 500, inputLimit: 1500, outputReserve: 300, ratio: 0.8, summaryTokens: 200,
    summarize: async () => { calls++; return {}; }, save: async () => {} }), /最近三轮|窗口/);
  assert.equal(calls, 0);
});

test('覆盖清单逐条校验学生消息、保留来源、重复及后续解决证据', () => {
  const rows = [row(0), row(1), row(2), row(3)];
  const body = { notes: [{ kind: 'progress' as const, text: '讨论', refs: ['m0'] }] };
  const valid = { notes: body.notes, coverage: coverage(rows) };
  assert.equal(validateSummaryCoverage(valid, null, rows, body).length, 2);
  for (const bad of [[], [valid.coverage[0], valid.coverage[0]],
    [{ ...valid.coverage[0], disposition: 'resolved', refs: ['m0'] }, valid.coverage[1]],
    [valid.coverage[0], { ...valid.coverage[1], disposition: 'retained' }],
    [valid.coverage[0], { ...valid.coverage[1], disposition: 'duplicate', refs: ['m3'] }],
    [valid.coverage[0], { ...valid.coverage[1], refs: ['foreign'] }]]) {
    assert.throws(() => validateSummaryCoverage({ coverage: bad }, null, rows, body));
  }
});

test('明确失效引用不再钉住摘要；同一原消息中的其他有效要求仍保留', async () => {
  const retired = [{ memoryId: 'mem1', messageId: 'm0', quote: '先用图像', status: 'superseded' }];
  const old = { notes: [
    { kind: 'request' as const, text: '旧要求', refs: ['m0'], quote: '先用图像' },
    { kind: 'constraint' as const, text: '范围', refs: ['m0'], quote: 'x>0' },
  ] };
  assert.deepEqual(retireSummaryNotes(old, retired).notes, [old.notes[1]]);
  const previous = { body: old, version: 1, throughMessageId: 'm1', throughCreatedAt: row(1).createdAt, coveredMessages: 2 };
  const result = await compactHistory({ pages: pages([]), previous, protectedFrom: null, retired,
    fixedTokens: 50, inputLimit: 4000, outputReserve: 300, ratio: 0.8, summaryTokens: 400,
    summarize: async () => { throw new Error('不应调用模型'); }, save: async () => {} });
  assert.deepEqual(result.checkpoint!.body.notes, [old.notes[1]]);
  assert.equal(previous.body.notes.length, 2, '原检查点不被变更');
});

test('确定性结果缓存合并并发请求、区分参数、过期及失败不缓存', async () => {
  let now = 0, computations = 0;
  const cache = new ResultCache<number>(2, 100, () => now);
  const compute = async () => { computations++; return 7; };
  assert.deepEqual(await Promise.all([cache.get('renderer-v1:x=2', compute), cache.get('renderer-v1:x=2', compute)]), [7, 7]);
  assert.equal(computations, 1); await cache.get('renderer-v1:x=3', compute); assert.equal(computations, 2);
  now = 101; await cache.get('renderer-v1:x=2', compute); assert.equal(computations, 3);
  await assert.rejects(cache.get('fail', async () => { throw new Error('failed'); }));
  assert.equal(await cache.get('fail', compute), 7); assert.equal(computations, 4);
  assert.ok(cache.stats().entries <= 2); assert.ok(cache.stats().hits >= 1);
});

test('缓存命中量单独记录，不从输入用量或窗口占用中扣减；缺失时保留未知', () => {
  const counters = initialCounters();
  recordUsage(counters, modelUsage({ inputTokens: 10000, outputTokens: 200, cachedInputTokens: 8000 }));
  assert.equal(counters.tokens.input, 10000); assert.equal(counters.tokens.cachedInput, 8000);
  assert.equal(modelUsage({ inputTokens: 100 }).cachedInputTokens, undefined);
});
