import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV2, convertArrayToReadableStream } from 'ai/test';
import { nextAgentStep, generateJson, summarizeContext, IncompleteSummaryError } from '../src/lib/model';
import { nativeToolSet } from '../src/agent/tools';
import { countersFrom, initialCounters } from '../src/agent/limits';
import { observeToolProgress } from '../src/agent/progress';
import { sseResponse } from '../src/lib/sse';

process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';

function observe(c: ReturnType<typeof initialCounters>, batch: string, ref = 'subject', value: unknown = { ok: true, version: 1 }) {
  return observeToolProgress(c, batch, [{ toolCallId: batch, toolName: 'readLearningContext', input: { ref } }],
    [{ toolCallId: batch, toolName: 'readLearningContext', value }]);
}

test('成功相同结果及交替读取不能无限循环，计数跨恢复且同批重放不重复累计', () => {
  let c = initialCounters();
  assert.equal(observe(c, '1'), false);
  assert.equal(observe(c, '2', 'artifacts'), false);
  assert.equal(observe(c, '3'), false);
  c = countersFrom(JSON.parse(JSON.stringify(c)));
  assert.equal(observe(c, '3'), false);
  assert.equal(c.progress?.repeated, 1);
  assert.equal(observe(c, '4', 'artifacts'), false);
  assert.equal(observe(c, '5'), true);
});

test('结果字段排序不制造进展；分页和真实版本变化会重置停滞', () => {
  const c = initialCounters();
  observe(c, '1'); observe(c, '2', 'subject', { version: 1, ok: true });
  assert.equal(c.progress?.repeated, 1);
  observe(c, '3', 'subject', { ok: true, version: 2 });
  assert.equal(c.progress?.repeated, 0);
  for (let offset = 0; offset < 5; offset++) {
    assert.equal(observeToolProgress(c, `page-${offset}`,
      [{ toolCallId: 'c', toolName: 'readLearningContext', input: { ref: 'tool_result', offset } }],
      [{ toolCallId: 'c', toolName: 'readLearningContext', value: { ok: true, data: '相同片段' } }]), false);
  }
  assert.equal(c.progress?.repeated, 0);
});

for (const name of ['respond', 'readLearningContext']) {
  test(`${name}参数即使完整，length终止也不能提交或执行`, async () => {
    const input = name === 'respond' ? { disposition: 'wait_user', content: [{ type: 'paragraph', text: '已经输出的部分' }] } : { ref: 'subject' };
    const model = new MockLanguageModelV2({ doStream: async () => ({ stream: convertArrayToReadableStream([
      { type: 'tool-input-start', id: 'c', toolName: name },
      { type: 'tool-input-delta', id: 'c', delta: JSON.stringify(input) },
      { type: 'tool-input-end', id: 'c' },
      { type: 'tool-call', toolCallId: 'c', toolName: name, input: JSON.stringify(input) },
      { type: 'finish', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } },
    ]) }) });
    let visible = '';
    const step = await nextAgentStep({ model, system: 'test', messages: [{ role: 'user', content: 'test' }],
      tools: nativeToolSet(), purpose: 'test', onText: async (delta) => { visible += delta; } });
    assert.equal(step.kind, 'issue');
    if (step.kind === 'issue') assert.equal(step.code, 'MODEL_TRUNCATED');
    assert.equal(step.usage?.outputTokens, 20);
    assert.equal(model.doStreamCalls.length, 1);
    if (name === 'respond') assert.equal(visible, '已经输出的部分');
  });
}

test('截断材料即使JSON合法也不解析/发布或消耗格式修正额度；截断摘要不返回可提交正文', async () => {
  for (const purpose of ['material', 'summary']) {
    const model = new MockLanguageModelV2({ doGenerate: async () => ({ content: [{ type: 'text', text: '{"pass":true}' }],
      finishReason: 'length', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, warnings: [] }) });
    let parsed = false;
    const repairBudget = { remaining: 1 };
    if (purpose === 'material') await assert.rejects(generateJson({ model, system: 'test', prompt: 'test', purpose: 'test',
      formatCorrections: 1, repairBudget, parse: () => { parsed = true; return {}; } }), /输出上限/);
    else await assert.rejects(summarizeContext({ model, system: 'test', prompt: 'test', maxOutputTokens: 100,
      abortSignal: new AbortController().signal, cacheKey: 'test' }), (error: unknown) => {
      assert.ok(error instanceof IncompleteSummaryError); assert.equal(error.usage.outputTokens, 20); return true;
    });
    assert.equal(parsed, false);
    assert.equal(repairBudget.remaining, 1);
    assert.equal(model.doGenerateCalls.length, 1);
  }
});

test('SSE等待时仅发送注释心跳，完成后正常关闭；读取端取消会中断生产者', async () => {
  let complete!: () => void;
  const response = sseResponse(async (emit) => {
    await new Promise<void>((resolve) => { complete = resolve; });
    emit({ type: 'run.completed', runId: 'r' });
  }, new AbortController().signal, 5);
  const reader = response.body!.getReader();
  const heartbeat = await reader.read();
  assert.equal(new TextDecoder().decode(heartbeat.value), ': heartbeat\n\n');
  complete();
  const result = await reader.read();
  assert.match(new TextDecoder().decode(result.value), /run.completed/);
  assert.equal((await reader.read()).done, true);

  let aborted = false;
  const cancelled = sseResponse(async (_, signal) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
  }, new AbortController().signal, 5);
  await cancelled.body!.cancel();
  assert.equal(aborted, true);
});
