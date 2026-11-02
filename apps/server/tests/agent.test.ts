import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV2, convertArrayToReadableStream } from 'ai/test';
import { nextAgentStep } from '../src/lib/model';
import { nativeToolSet } from '../src/agent/tools';
import { parseReview } from '../src/jobs/review';

function modelFor(calls: Array<{ toolName: string; input: unknown }>, size: number) {
  return new MockLanguageModelV2({ doStream: async () => ({
    stream: convertArrayToReadableStream([
      { type: 'stream-start' as const, warnings: [] },
      ...calls.flatMap((call, index) => {
        const input = JSON.stringify(call.input), id = `call-${index}`;
        const deltas = [];
        for (let i = 0; i < input.length; i += size) deltas.push({ type: 'tool-input-delta' as const, id, delta: input.slice(i, i + size) });
        return [
          { type: 'tool-input-start' as const, id, toolName: call.toolName }, ...deltas,
          { type: 'tool-input-end' as const, id },
          { type: 'tool-call' as const, toolCallId: id, toolName: call.toolName, input },
        ];
      }),
      { type: 'finish' as const, finishReason: 'tool-calls' as const, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } },
    ]),
  }) });
}

for (const size of [1, 3, 10000]) {
  test(`真实 SDK 参数分块 ${size} 字符时，正文完整保留且只运行一个模型步骤`, async () => {
    const text = '先想一步📖\n令 \\alpha="x"，再看条件。';
    const model = modelFor([{ toolName: 'respond', input: { disposition: 'wait_user', text, refs: [] } }], size);
    const step = await nextAgentStep({ model, system: 'test', messages: [{ role: 'user', content: '题目' }], tools: nativeToolSet(), purpose: 'test' });
    assert.equal(step.kind, 'respond');
    if (step.kind === 'respond') assert.equal(step.text, text);
    assert.equal(model.doStreamCalls.length, 1);
    assert.ok(model.doStreamCalls[0]!.tools?.some((tool) => tool.name === 'respond'));
  });
}

test('混用 respond 与业务工具时返回协议问题，不向学生泄漏未校验正文', async () => {
  const step = await nextAgentStep({
    model: modelFor([
      { toolName: 'respond', input: { disposition: 'finish', text: '不可提前发布' } },
      { toolName: 'readLearningContext', input: { ref: 'subject' } },
    ], 1),
    system: 'test', messages: [{ role: 'user', content: '题目' }], tools: nativeToolSet(), purpose: 'test',
  });
  assert.equal(step.kind, 'issue');
  if (step.kind === 'issue') assert.equal(step.code, 'PROTOCOL_MIXED');
});

test('复核只接受真实布尔值，字符串 false 或缺字段均拒绝', () => {
  assert.equal(parseReview('{"pass":false,"issues":["条件不符"]}').pass, false);
  assert.equal(parseReview('{"pass":true,"issues":[]}').pass, true);
  for (const pass of ['false', 'true', 1, null]) assert.throws(() => parseReview(JSON.stringify({ pass, issues: [] })));
  assert.throws(() => parseReview('{}'));
});

test('截止时间信号会中断等待中的 SDK 模型流', async () => {
  let interrupted = false;
  const model = new MockLanguageModelV2({ doStream: async ({ abortSignal }) => ({
    stream: new ReadableStream({
      start(controller) {
        const abort = () => { interrupted = true; controller.error(new Error('aborted')); };
        if (abortSignal?.aborted) abort();
        else abortSignal?.addEventListener('abort', abort, { once: true });
      },
    }),
  }) });
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30);
  try {
    const result = await nextAgentStep({ model, system: 'test', messages: [{ role: 'user', content: 'test' }],
      tools: nativeToolSet(), purpose: 'test', abortSignal: controller.signal });
    assert.equal(result.kind, 'issue');
    assert.equal(interrupted, true);
    assert.ok(Date.now() - started < 1000);
  } finally { clearTimeout(timeout); }
});
