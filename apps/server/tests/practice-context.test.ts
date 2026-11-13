import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { MockLanguageModelV2, convertArrayToReadableStream } from 'ai/test';
import { db } from '../src/lib/db';
import { readLearningContext } from '../src/agent/tool-executor';
import { assembleSystem, learningData } from '../src/agent/context';
import { nextAgentStep } from '../src/lib/model';
import { nativeToolSet } from '../src/agent/tools';
import type { TurnPolicy } from '../src/agent/policy';
import { replaceMethod } from './helpers/mock';
import { uploadService } from '../src/services/upload.service';

const policy: TurnPolicy = { subjectId: 's', subjectRevisionId: 'r', stage: 'guiding', subjectConfirmed: true,
  allowedTools: [], answerPermission: false, allowSolution: false,
  focus: { artifactId: 'artifact', artifactVersion: 1, attemptId: 'attempt', exerciseId: 'q2' } };
const ctx = { userId: 'student', conversationId: 'conversation', policy };
const viewedAt = new Date('2026-11-10T03:00:00Z');
function fixture(stage = 'summary') {
  return { id: 'attempt', stage, submittedAt: viewedAt, completedAt: viewedAt, exerciseIds: ['q1', 'q2'],
    artifact: { exercises: ['q1', 'q2'].map((id, order) => ({ id, order, stem: `${id}题干`, topic: '函数', difficulty: 'basic', answer: `${id}参考答案`, analysis: `${id}解析` })) },
    answers: ['q1', 'q2'].map((exerciseId) => ({ exerciseId, textDraft: `${exerciseId}本人作答`, markedUnknown: exerciseId === 'q2', hintsUsed: 1,
      selfEval: exerciseId === 'q2' ? 'partial' : 'independent', solutionViewedAt: viewedAt, photoIds: [] as string[] })) };
}
function stub(t: TestContext, attempt = fixture()) {
  replaceMethod(t, db.conversation, 'findFirst', async () => ({ id: 'conversation' }));
  replaceMethod(t, db.practiceAttempt, 'findFirst', async (input) => {
    assert.deepEqual(input.where, { id: 'attempt', userId: 'student', artifact: { conversationId: 'conversation', subjectRevisionId: 'r' } });
    return attempt;
  });
  replaceMethod(t, db, '$transaction', async () => { throw new Error('未授权追问不能写解析查看记录'); });
  return attempt;
}

test('练习追问只投影焦点题、自评来源、帮助和流程时间，曾看解析不重新授权答案', async (t) => {
  stub(t);
  const result = await readLearningContext(ctx, { ref: 'attempt', attemptId: 'attempt' });
  const data = JSON.parse(JSON.stringify(result));
  assert.equal(data.attempt.stage, 'summary');
  assert.equal(data.attempt.submittedAt, viewedAt.toISOString());
  assert.equal(data.attempt.completedAt, viewedAt.toISOString());
  assert.equal(data.attempt.assessmentSource, 'student_self_report');
  assert.deepEqual(data.attempt.answers, [{ exerciseId: 'q2', textDraft: 'q2本人作答', markedUnknown: true, hintsUsed: 1, selfEval: 'partial', solutionViewedAt: viewedAt.toISOString() }]);
  assert.equal(data.attempt.exercises.length, 1);
  assert.equal(data.attempt.exercises[0].id, 'q2');
  assert.doesNotMatch(JSON.stringify(result), /q1|参考答案|解析/);
});

test('查询约束用户及来源；无焦点、错轮次或来源找不到时不返回作答', async (t) => {
  stub(t);
  for (const focus of [{ ...policy.focus, exerciseId: 'other' }, { ...policy.focus, exerciseId: undefined }]) {
    const result = await readLearningContext({ ...ctx, policy: { ...policy, focus } }, { ref: 'attempt', attemptId: 'attempt' });
    assert.equal((result as { code: string }).code, 'INVALID_INPUT');
  }
  assert.equal((await readLearningContext(ctx, { ref: 'attempt', attemptId: 'other' }) as { code: string }).code, 'INVALID_INPUT');
  replaceMethod(t, db.practiceAttempt, 'findFirst', async () => null);
  assert.equal((await readLearningContext(ctx, { ref: 'attempt', attemptId: 'attempt' }) as { code: string }).code, 'NOT_FOUND');
});

test('尚未作答或自评时保留缺失，不伪造结果或解析暴露记录', async (t) => {
  const attempt = stub(t, fixture('doing'));
  attempt.answers = [];
  const result: any = await readLearningContext(ctx, { ref: 'attempt', attemptId: 'attempt' });
  assert.deepEqual(result.attempt.answers, []);
  assert.equal(result.attempt.exercises[0].id, 'q2');
  assert.equal(result.attempt.exercises[0].answer, undefined);
});

test('首次授权读取解析返回本次暴露记录，重复读取保留首次时间且不加载其他题答案', async (t) => {
  const attempt = stub(t, fixture('doing'));
  attempt.answers = [];
  let saved: any = null;
  replaceMethod(t, db, '$transaction', async (action) => action({
    $queryRaw: async () => [], practiceAttempt: { findUnique: async () => ({ stage: 'doing' }) },
    practiceAnswer: { findUnique: async () => saved, upsert: async ({ create, update }: any) => {
      saved = saved ? { ...saved, ...update } : { ...create, textDraft: null, markedUnknown: false, hintsUsed: 0, selfEval: null };
      return saved;
    } },
  }));
  const authorized = { ...ctx, policy: { ...policy, answerPermission: true, allowSolution: true } };
  const first: any = await readLearningContext(authorized, { ref: 'attempt', attemptId: 'attempt' });
  assert.ok(first.attempt.answers[0].solutionViewedAt instanceof Date);
  assert.equal(first.attempt.answers[0].selfEval, null);
  assert.equal(first.attempt.exercises[0].answer, 'q2参考答案');
  assert.doesNotMatch(JSON.stringify(first), /q1/);
  const second: any = await readLearningContext(authorized, { ref: 'attempt', attemptId: 'attempt' });
  assert.equal(second.attempt.answers[0].solutionViewedAt.getTime(), first.attempt.answers[0].solutionViewedAt.getTime());
});

test('真实SDK输入装配只附焦点题本人照片、自评和题干，不携带其他题或参考答案（无付费调用）', async (t) => {
  const attempt = stub(t);
  attempt.answers[0]!.photoIds = ['other-question'];
  attempt.answers[1]!.photoIds = ['current-photo', 'missing-photo'];
  replaceMethod(t, db.attachment, 'findFirst', async ({ where }) => {
    assert.equal(where.userId, 'student'); assert.equal(where.purpose, 'answer_photo'); assert.equal(where.status, 'ready');
    assert.notEqual(where.id, 'other-question');
    return where.id === 'current-photo' ? { scope: { conversationId: 'conversation', subjectRevisionId: 'r', attemptId: 'attempt', exerciseId: 'q2' } } : null;
  });
  let imageReads = 0;
  replaceMethod(t, uploadService, 'read', async (userId, id) => {
    assert.equal(userId, 'student'); assert.equal(id, 'current-photo'); imageReads++;
    return { bytes: new Uint8Array([137, 80, 78, 71]), format: 'png' };
  });
  const revision = { id: 'r', subjectId: 's', version: 1, content: { text: '来源题目' }, tags: [], subquestions: [], activeSubquestionIndex: 0 };
  replaceMethod(t, db.subjectRevision, 'findUnique', async () => revision);
  replaceMethod(t, db.subjectRevision, 'findFirst', async () => revision);
  replaceMethod(t, db.processTranscript, 'findMany', async () => []);
  replaceMethod(t, db.teachingMemory, 'findMany', async () => []);
  replaceMethod(t, db.toolExecution, 'findMany', async () => []);
  replaceMethod(t, db.artifact, 'findMany', async () => []);
  replaceMethod(t, db.generationJob, 'findMany', async () => []);
  const facts = await learningData(policy, 'student', 'conversation');
  const system = await assembleSystem(policy, { kind: 'chat', planned: true, goals: [] });
  const model = new MockLanguageModelV2({ doStream: async () => ({ stream: convertArrayToReadableStream([
    { type: 'tool-call', toolCallId: 'reply', toolName: 'respond', input: JSON.stringify({ disposition: 'wait_user', content: [{ type: 'paragraph', text: '你是在这一步卡住了吗？' }] }) },
    { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } },
  ]) }) });
  await nextAgentStep({ model, system, tools: nativeToolSet(), messages: [facts, { role: 'user', content: '这道题我没理解' }], purpose: 'test' });
  const sent = JSON.stringify(model.doStreamCalls[0]!.prompt);
  assert.match(sent, /q2题干/);
  assert.match(sent, /q2本人作答/);
  assert.match(sent, /student_self_report/);
  assert.match(sent, /partial/);
  assert.match(sent, /solutionViewedAt/);
  assert.equal(imageReads, 1);
  assert.match(sent, /attachedCount/);
  assert.match(sent, /missing-photo/);
  assert.match(sent, /image\/png/);
  assert.doesNotMatch(sent, /other-question/);
  assert.match(system, /学生自评，不是客观判分或掌握度/);
  assert.doesNotMatch(sent, /q1|q2参考答案|q2解析/);
});
