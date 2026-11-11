import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV2, convertArrayToReadableStream } from 'ai/test';
import { assembleSystem } from '../src/agent/context';
import { loadTeachingTaskPrompt, loadTutoringPolicy } from '../src/agent/prompts';
import { nextAgentStep } from '../src/lib/model';
import { nativeToolSet } from '../src/agent/tools';
import type { TurnPolicy } from '../src/agent/policy';

test('实际模型SDK请求收到教学Skill正文和本轮权限，不依赖模型访问文件或GitHub', async () => {
  const policy: TurnPolicy = { subjectId: 's', subjectRevisionId: 'r', stage: 'guiding', subjectConfirmed: true,
    allowedTools: [], allowSolution: false, answerPermission: false, focus: {}, teachingMode: 'question' };
  const system = await assembleSystem(policy, { kind: 'chat', planned: true, goals: [] });
  const model = new MockLanguageModelV2({ doStream: async () => ({ stream: convertArrayToReadableStream([
    { type: 'tool-call', toolCallId: 'reply', toolName: 'respond', input: JSON.stringify({ disposition: 'wait_user', content: [{ type: 'paragraph', text: '先看平方项。' }] }) },
    { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } },
  ]) }) });
  const result = await nextAgentStep({ model, system, tools: nativeToolSet(), messages: [{ role: 'user', content: '给我一个提示' }], purpose: 'test' });
  assert.equal(result.kind, 'respond');
  const sent = model.doStreamCalls[0]!.prompt.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(sent.includes(await loadTutoringPolicy('dialogue')));
  assert.match(sent, /"allowSolution":false/);
  assert.doesNotMatch(sent, /github\.com|\/tmp\/|当前仅完成规格|解题每轮只推进一层/);
  assert.match(sent, /respond\.learning/);
  assert.doesNotMatch(sent, /专用存储尚未接通/);
});

test('后台任务包含相同教学方法，但任务范围和JSON协议仍由具体任务约束', async () => {
  for (const name of ['lesson', 'lesson-revision', 'practice'] as const) {
    const prompt = await loadTeachingTaskPrompt(name);
    const task = name === 'practice' ? 'practice' : 'lesson';
    assert.ok(prompt.includes(await loadTutoringPolicy(task)));
    assert.match(prompt, /JSON/);
    assert.match(prompt, name === 'practice' ? /不重新摸底、不创建路线、不等待回答/ : /不与学生现场对话，不等待回答/);
  }
});

