import assert from 'node:assert/strict';
import test from 'node:test';
import { materialTaskAnchors, type MaterialTaskView } from '@luma/shared';
import { projectMaterialTasks } from '../src/services/material-tasks';
import { turnPlanSchema } from '../src/agent/tools';
import { canReuseLesson } from '../src/agent/lesson-reuse';
import type { TurnPolicy } from '../src/agent/policy';

const run = { id: 'r', userMessageId: 'u', subjectRevisionId: 'v1', taskFrame: {} };
const job = { id: 'j', type: 'lesson', runId: 'r', subjectRevisionId: 'v1', status: 'running', step: '复核图文', resultArtifactId: null as string | null, retryOfJobId: null as string | null, payload: { target: '斜率的含义' }, error: null as unknown };
const artifact = { id: 'a', type: 'lesson', publishStatus: 'published', content: { lesson: { title: '斜率为什么表示变化快慢', sections: [{ heading: '横向一步与纵向变化', body: 'PRIVATE_BODY' }] } } };

test('主动图解目标保留来源和依据，不因此授权练习或完整答案', () => {
  const plan = { learningIntent: 'none', memories: [], goals: [{ type: 'lesson', source: 'teaching_decision', reason: '学生无法建立斜率与变化的关系', target: '用直线图说明斜率' }], solutionRequested: false };
  assert.equal(turnPlanSchema.parse(plan).goals[0]?.source, 'teaching_decision');
  assert.equal(turnPlanSchema.safeParse({ ...plan, goals: [{ type: 'lesson', source: 'teaching_decision' }] }).success, false);
  assert.equal(turnPlanSchema.safeParse({ ...plan, goals: [{ type: 'practice', source: 'teaching_decision', reason: '随便出题' }] }).success, false);
});

test('生成卡原位转为成果卡，仅投影标题和章节摘要', () => {
  const pending = projectMaterialTasks([job], [], [run], 'v1')[0]!;
  const published = projectMaterialTasks([{ ...job, status: 'succeeded', resultArtifactId: 'a', step: null }], [artifact], [run], 'v1')[0]!;
  assert.equal(pending.id, published.id); assert.equal(pending.artifactId, null);
  assert.equal(published.title, '斜率为什么表示变化快慢'); assert.equal(published.artifactId, 'a');
  assert.equal(published.summary, '横向一步与纵向变化'); assert.doesNotMatch(JSON.stringify(published), /PRIVATE_BODY/);
});

test('练习失败不挂旧讲义，显式重试链更新原卡且保留来源', () => {
  const failed = { ...job, type: 'exercise_set', status: 'failed', error: { message: '复核未通过', retryable: true } };
  const retry = { ...failed, id: 'j2', runId: 'r2', retryOfJobId: 'j', status: 'running', error: null };
  const cards = projectMaterialTasks([failed, retry], [artifact], [run, { ...run, id: 'r2' }], 'v1');
  assert.equal(cards.length, 1); assert.equal(cards[0]?.id, 'j'); assert.equal(cards[0]?.jobId, 'j2');
  assert.equal(cards[0]?.runId, 'r'); assert.equal(cards[0]?.artifactId, null); assert.equal(cards[0]?.type, 'exercise_set');
});

test('卡片只绑定原轮次回复，原消息未加载时不挂到当前轮', () => {
  const card = projectMaterialTasks([job], [], [run], 'v1')[0]!;
  const messages = [{ id: 'u', role: 'user' }, { id: 'reply', role: 'assistant', runId: 'r' }, { id: 'new', role: 'user' }, { id: 'newReply', role: 'assistant', runId: 'other' }];
  assert.deepEqual(Object.keys(materialTaskAnchors(messages, [card])), ['reply']);
  assert.deepEqual(Object.keys(materialTaskAnchors(messages.slice(2), [card])), []);
});

test('已验证复用有本轮卡，旧版本标历史，未发布材料不伪装成功', () => {
  const reused = { ...run, taskFrame: { goals: [{ type: 'lesson', reuseArtifactId: 'a', completedArtifactId: 'a' }] } };
  const cards = projectMaterialTasks([], [artifact], [reused], 'v2');
  assert.equal(cards.length, 1); assert.equal(cards[0]?.jobId, null); assert.equal(cards[0]?.historical, true);
  const missing = projectMaterialTasks([{ ...job, status: 'succeeded', resultArtifactId: 'missing' }], [artifact], [run], 'v1')[0]!;
  assert.equal(missing.status, 'failed'); assert.equal(missing.artifactId, null);
});

test('讲义复用拒绝未知授权和其他练习焦点，解析仍受本轮权限限制', () => {
  const policy: TurnPolicy = { subjectId: 's', subjectRevisionId: 'v1', subjectConfirmed: true, stage: 'guiding', allowedTools: [], allowSolution: false, answerPermission: false, focus: {} };
  assert.equal(canReuseLesson(policy, null), false);
  assert.equal(canReuseLesson(policy, { answerPermission: true }), false);
  assert.equal(canReuseLesson(policy, { answerPermission: false, evidence: { focus: {} } }), true);
  assert.equal(canReuseLesson({ ...policy, focus: { attemptId: 'p', exerciseId: 'e2' } }, { evidence: { focus: { attemptId: 'p', exerciseId: 'e1' } } }), false);
  const card = projectMaterialTasks([{ ...job, type: 'exercise_set', status: 'succeeded', resultArtifactId: 'practice' }], [{ id: 'practice', type: 'exercise_set', publishStatus: 'published', content: { answer: 'SECRET_ANSWER' } }], [run], 'v1')[0];
  assert.doesNotMatch(JSON.stringify(card), /SECRET_ANSWER/);
});
