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
    const model = modelFor([{ toolName: 'respond', input: { disposition: 'wait_user', content: [{ type: 'paragraph', text }], refs: [] } }], size);
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
      { toolName: 'respond', input: { disposition: 'finish', content: [{ type: 'paragraph', text: '不可提前发布' }] } },
      { toolName: 'readLearningContext', input: { ref: 'subject' } },
    ], 1),
    system: 'test', messages: [{ role: 'user', content: '题目' }], tools: nativeToolSet(), purpose: 'test',
  });
  assert.equal(step.kind, 'issue');
  if (step.kind === 'issue') assert.equal(step.code, 'PROTOCOL_MIXED');
});

test('评价和后续短验证经SDK完整保留，流式正文不泄漏验证元数据', async () => {
  const prompt = '规则为y=x+1，只允许输入0和2，请写出定义域和值域并说明对应过程。';
  const learning = { action: 'update', routeId: 'route', expectedVersion: 2,
    check: { action: 'evaluate', checkId: 'old-check', evaluation: 'pass', criteriaResults: [
      { criterionId: 'reason', evidenceType: 'reasoning', met: true, quote: '输入的集合', feedback: '能区分角色' },
    ] }, followupCheck: { nodeId: 'next-node', prompt, taskKind: 'application' } };
  let visible = '';
  const model = modelFor([{ toolName: 'respond', input: { disposition: 'wait_user', content: [{ type: 'paragraph', text: prompt }], learning } }], 1);
  const step = await nextAgentStep({ model, system: 'test', messages: [{ role: 'user', content: '我的判断是输入的集合。' }],
    tools: nativeToolSet(), purpose: 'test', onText: async (delta) => { visible += delta; } });
  assert.equal(step.kind, 'respond');
  if (step.kind === 'respond') assert.deepEqual(step.learning, learning);
  assert.equal(visible, prompt);
  assert.equal(model.doStreamCalls.length, 1);
});

test('复核只接受真实布尔值，字符串 false 或缺字段均拒绝', () => {
  assert.equal(parseReview('{"pass":false,"issues":["条件不符"]}').pass, false);
  assert.equal(parseReview('{"pass":true,"issues":[]}').pass, true);
  for (const pass of ['false', 'true', 1, null]) assert.throws(() => parseReview(JSON.stringify({ pass, issues: [] })));
  assert.throws(() => parseReview('{}'));
});

test('统一模型层传入稳定缓存键且读取真实SDK的缓存用量', async () => {
  const model = new MockLanguageModelV2({ doStream: async () => ({ stream: convertArrayToReadableStream([
    { type: 'tool-call', toolCallId: 'cached', toolName: 'respond', input: JSON.stringify({ disposition: 'wait_user', content: [{ type: 'paragraph', text: '继续观察' }] }) },
    { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 2000, outputTokens: 20, totalTokens: 2020, cachedInputTokens: 1536 } },
  ]) }) });
  const step = await nextAgentStep({ model, system: 'stable rules', messages: [{ role: 'user', content: '继续' }], tools: nativeToolSet(),
    purpose: 'test', cacheKey: 'luma:opaque-session-key' });
  assert.equal(step.usage?.inputTokens, 2000); assert.equal(step.usage?.cachedInputTokens, 1536);
  assert.equal(model.doStreamCalls[0]!.providerOptions?.openai?.promptCacheKey, 'luma:opaque-session-key');
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

test('respond 正文按块解码，保留中文、转义与 emoji，不输出 JSON 或 refs', async () => {
  const text = '先想一步📖\n令 \\alpha="x"，再看条件。';
  const chunks: string[] = [];
  const step = await nextAgentStep({ model: modelFor([{ toolName: 'respond', input: { disposition: 'wait_user', content: [{ type: 'paragraph', text }], refs: ['hidden-ref'] } }], 1),
    system: 'test', messages: [{ role: 'user', content: '题目' }], tools: nativeToolSet(), purpose: 'test', onText: async (delta) => { chunks.push(delta); } });
  assert.equal(step.kind, 'respond'); assert.ok(chunks.length > 2);
  assert.equal(chunks.join(''), text); assert.equal(chunks.join('').includes('hidden-ref'), false);
});

test('后续出现混用调用时撤回未完成正文，不作为完整回复', async () => {
  let visible = '', resets = 0;
  const step = await nextAgentStep({ model: modelFor([
    { toolName: 'respond', input: { disposition: 'finish', content: [{ type: 'paragraph', text: '临时正文' }] } },
    { toolName: 'createPractice', input: { count: 2 } },
  ], 1), system: 'test', messages: [{ role: 'user', content: '出题' }], tools: nativeToolSet(), purpose: 'test',
    onText: async (delta) => { visible += delta; }, onReset: async () => { visible = ''; resets++; } });
  assert.equal(step.kind, 'issue'); assert.equal(visible, ''); assert.equal(resets, 1);
});

test('目标记录是单步控制调用，允许组合目标且不夹带教学', async () => {
  const step = await nextAgentStep({ model: modelFor([{ toolName: 'planTurn', input: { learningIntent: 'none', goals: [{ type: 'lesson' }, { type: 'practice', count: 2 }], solutionRequested: false, memories: [] } }], 2),
    system: 'test', messages: [{ role: 'user', content: '讲解后出两道题' }], tools: nativeToolSet(true), purpose: 'test' });
  assert.equal(step.kind, 'plan'); if (step.kind === 'plan') assert.deepEqual(step.plan.goals.map((g) => g.type), ['lesson', 'practice']);
});

test('结构化回复跨JSON分块流式输出，保留顺序但不泄漏元数据', async () => {
  const content = [{ type: 'heading', text: '先观察' }, { type: 'paragraph', text: '看平方项📖' }, { type: 'formula', text: '(x-2)^2' }];
  const chunks: string[] = [];
  const step = await nextAgentStep({ model: modelFor([{ toolName: 'respond', input: { disposition: 'wait_user', content, refs: ['hidden-ref'] } }], 1),
    system: 'test', messages: [{ role: 'user', content: '继续' }], tools: nativeToolSet(), purpose: 'test', onText: async (delta) => { chunks.push(delta); } });
  assert.equal(step.kind, 'respond');
  if (step.kind === 'respond') {
    assert.deepEqual(step.content, content);
    assert.equal(chunks.join(''), step.text);
    assert.equal(step.text, '### 先观察\n\n看平方项📖\n\n$$(x-2)^2$$');
  }
  assert.doesNotMatch(chunks.join(''), /hidden-ref|disposition|"type"/);
});

test('新模型回复只接受内容块，旧text字段和未知块类型被拒绝', async () => {
  for (const input of [{ disposition: 'finish', text: '旧协议' }, { disposition: 'finish', content: [{ type: 'html', text: '<b>bad</b>' }] }]) {
    const step = await nextAgentStep({ model: modelFor([{ toolName: 'respond', input }], 1), system: 'test', messages: [{ role: 'user', content: '继续' }], tools: nativeToolSet(), purpose: 'test' });
    assert.equal(step.kind, 'issue');
  }
});


test('规划同步返回带原话的记忆候选，不遗漏字段也不将内部记录转成学生正文', async () => {
  const memories = [{ kind: 'request', text: '只用数轴讲解', quote: '请只用数轴举例。' }];
  const step = await nextAgentStep({ model: modelFor([{ toolName: 'planTurn', input: { learningIntent: 'none', memories, goals: [], solutionRequested: false } }], 1),
    system: 'test', messages: [{ role: 'user', content: memories[0]!.quote }], tools: nativeToolSet(true), purpose: 'test', onText: async () => { assert.fail('规划记录不属于可见正文'); } });
  assert.equal(step.kind, 'plan');
  if (step.kind === 'plan') assert.deepEqual(step.plan.memories, memories);
  const invalid = await nextAgentStep({ model: modelFor([{ toolName: 'planTurn', input: { goals: [], solutionRequested: false } }], 1),
    system: 'test', messages: [{ role: 'user', content: '请只用数轴' }], tools: nativeToolSet(true), purpose: 'test' });
  assert.equal(invalid.kind, 'issue');
});
