import assert from 'node:assert/strict';
import test from 'node:test';
import { combinedSupport, LearningUpdateError, validateCriteria } from '../src/services/learning-route';
import { assembleSystem } from '../src/agent/context';
import { contentProfileRules, MATH_PROFILE, requireMaterialProfile, UNCONFIGURED_PROFILE } from '../src/agent/content-profile';
import { nativeToolSet } from '../src/agent/tools';
import type { TurnPolicy } from '../src/agent/policy';
import { LearningUpdate, validateLearningIntent } from '../src/agent/learning-contracts';
import { turnPlanSchema } from '../src/agent/tools';
import { taskFrameFrom, type TaskFrame } from '../src/agent/types';

const criteria = [{ id: 'reason', description: '能说明判断的理由', requiresIndependent: true }];
const response = [{ criterionId: 'reason', evidenceType: 'reasoning', met: true, quote: '变化量之比不变', feedback: '说明了比值不变' }];
test('评价可携带后续验证，不能脱离旧题评价或在暂停/结束时设置', () => {
  const followupCheck = { nodeId: 'next-node', prompt: '请在一个新情境中解释变化量之比。', taskKind: 'application' };
  const update = { action: 'update', routeId: 'route', expectedVersion: 2,
    check: { action: 'evaluate', checkId: 'check', evaluation: 'pass', criteriaResults: response }, followupCheck };
  assert.equal(LearningUpdate.safeParse(update).success, true);
  for (const status of ['paused', 'ended']) assert.equal(LearningUpdate.safeParse({ ...update, status }).success, false);
  assert.equal(LearningUpdate.safeParse({ ...update, check: undefined }).success, false);
  assert.equal(LearningUpdate.safeParse({ ...update, check: { action: 'issue', ...followupCheck } }).success, false);
  assert.equal(LearningUpdate.safeParse({ ...update, followupCheck: { ...followupCheck, prompt: '' } }).success, false);
});
test('连续学习决策必须显式规划，材料完成不能替代路线候选，恢复时保留意图', async () => {
  const plan = { contentProfileId: 'math', learningIntent: 'start', goals: [], solutionRequested: false, memories: [] };
  assert.equal(turnPlanSchema.parse(plan).learningIntent, 'start');
  const { learningIntent, ...missing } = plan;
  assert.equal(turnPlanSchema.safeParse(missing).success, false);
  const frame: TaskFrame = { kind: 'material', planned: true, contentProfile: MATH_PROFILE, learningIntent: 'start',
    goals: [{ type: 'lesson', completedArtifactId: 'actual-lesson' }] };
  const policy: TurnPolicy = { subjectId: 's', subjectRevisionId: 'r', subjectConfirmed: true, stage: 'guiding',
    allowedTools: [], allowSolution: false, answerPermission: false, focus: {} };
  assert.equal(validateLearningIntent(frame, policy)?.ok, false);
  assert.equal(taskFrameFrom(JSON.parse(JSON.stringify(frame))).learningIntent, 'start');
  const update = LearningUpdate.parse({ action: 'create', goal: '区分输入与输出', goalQuote: '从输入和输出的区别开始带着我学',
    nodes: [{ key: 'roles', objective: '能分清输入输出角色', criteria: [{ id: 'explain', description: '能根据对应关系说明输入和输出角色', requiresIndependent: true }] }] });
  assert.equal(validateLearningIntent(frame, policy, update), null);
  for (const changed of [{ ...policy, subjectConfirmed: false }, { ...policy, allowSolution: true }, { ...policy, focus: { sectionId: 's1' } }, { ...policy, focus: { attemptId: 'a' } }]) {
    assert.equal(validateLearningIntent(frame, changed), null);
  }
  for (const learningIntent of ['none', 'continue', undefined] as const) assert.equal(validateLearningIntent({ ...frame, learningIntent }, policy), null);
  assert.equal(validateLearningIntent({ ...frame, contentProfile: UNCONFIGURED_PROFILE }, policy), null);
  const system = await assembleSystem(policy, frame);
  assert.match(system, /"learningIntent":"start"/);
  assert.match(system, /最终respond必须带learning.create/);
});
test('节点通过必须覆盖原有条件并引用实际回答，不能凭自述/遗漏/伪造证据', () => {
  assert.doesNotThrow(() => validateCriteria(criteria, response, '变化量之比不变', 'independent', 'pass'));
  assert.throws(() => validateCriteria(criteria, response, '我懂了', 'independent', 'pass'), LearningUpdateError);
  assert.throws(() => validateCriteria(criteria, [{ ...response[0]!, evidenceType: 'self_report', quote: '我懂了' }], '我懂了', 'independent', 'pass'), /自述/);
  assert.throws(() => validateCriteria(criteria, [], '变化量之比不变', 'independent', 'pass'), /逐项覆盖/);
  assert.throws(() => validateCriteria(criteria, [{ ...response[0]!, met: false }], '变化量之比不变', 'independent', 'pass'), /全部条件/);
  assert.doesNotThrow(() => validateCriteria(criteria, [{ ...response[0]!, met: false, quote: '' }], '不知道', 'independent', 'insufficient_evidence'));
});
test('提示/讲解/解析帮助只升不降，已看过答案不能伪装独立通过', () => {
  assert.equal(combinedSupport('solution_seen', 'none'), 'solution_seen');
  assert.equal(combinedSupport('hinted', 'explanation'), 'explained');
  assert.throws(() => validateCriteria(criteria, response, '变化量之比不变', 'hinted', 'pass'), /独立完成/);
  assert.throws(() => validateCriteria(criteria, response, '变化量之比不变', 'solution_seen', 'pass'), /复述/);
  assert.doesNotThrow(() => validateCriteria([{ ...criteria[0]!, requiresIndependent: false }], response, '变化量之比不变', 'hinted', 'pass'));
});
test('需巩固必须有实际错误依据，自述/不确定/全满足不能推断答错', () => {
  const wrong = { ...response[0]!, met: false, quote: '直接把输入集当成输出集', feedback: '混淆了输入与输出的范围' };
  assert.doesNotThrow(() => validateCriteria(criteria, [wrong], wrong.quote, 'independent', 'needs_review'));
  assert.throws(() => validateCriteria(criteria, response, '变化量之比不变', 'independent', 'needs_review'), /明确证据/);
  assert.throws(() => validateCriteria(criteria, [{ ...wrong, quote: '' }], '不知道', 'independent', 'needs_review'), /明确证据/);
  for (const evidenceType of ['self_report', 'repetition', 'unclear']) {
    const self = { ...wrong, evidenceType, quote: '我不确定' };
    assert.throws(() => validateCriteria(criteria, [self], '我不确定', 'independent', 'needs_review'), /明确证据/);
    assert.doesNotThrow(() => validateCriteria(criteria, [self], '我不确定', 'independent', 'insufficient_evidence'));
    assert.doesNotThrow(() => validateCriteria(criteria, [self], '我不确定', 'independent', 'uncertain'));
  }
});
test('未配置内容不加载数学规则，不暴露材料工具，既有数学任务快照仍可恢复', async () => {
  const policy: TurnPolicy = { subjectId: 's', stage: 'guiding', subjectConfirmed: true, subjectRevisionId: 'r',
    allowedTools: ['readLearningContext'], allowSolution: false, answerPermission: false, focus: {} };
  const system = await assembleSystem(policy, { kind: 'chat', planned: true, contentProfile: UNCONFIGURED_PROFILE, goals: [] });
  assert.doesNotMatch(system, /# 内容规则：数学|contentProfile.*"id":"math"/);
  assert.match(system, /当前内容尚未配置/);
  assert.deepEqual(Object.keys(nativeToolSet(false, policy.allowedTools)).sort(), ['readLearningContext', 'respond']);
  assert.throws(() => requireMaterialProfile(UNCONFIGURED_PROFILE), /没有可用/);
  assert.throws(() => requireMaterialProfile({ id: 'math', version: '999' }));
  assert.deepEqual(requireMaterialProfile(undefined), MATH_PROFILE);
  assert.match(await contentProfileRules(MATH_PROFILE), /quadratic\/geometry/);
});

test('待确认范围与未支持领域分开，旧运行的占位配置也不会误报不支持数学', async () => {
  const policy: TurnPolicy = { subjectId: 's', stage: 'clarifying', subjectConfirmed: false, subjectRevisionId: 'r',
    allowedTools: ['readLearningContext', 'recognizeMaterial'], allowSolution: false, answerPermission: false, focus: {} };
  for (const contentProfile of [undefined, UNCONFIGURED_PROFILE, MATH_PROFILE]) {
    const system = await assembleSystem(policy, { kind: 'chat', planned: true, contentProfile, goals: [] });
    assert.match(system, /当前只是在核对学生的学习范围/);
    assert.match(system, /"contentProfile":null/);
    assert.doesNotMatch(system, /当前内容尚未配置教学能力|# 内容规则：数学/);
    assert.deepEqual(Object.keys(nativeToolSet(false, policy.allowedTools)).sort(), ['readLearningContext', 'recognizeMaterial', 'respond']);
  }
  for (const contentProfile of [undefined, UNCONFIGURED_PROFILE]) {
    const classified = await assembleSystem({ ...policy, subjectConfirmed: true }, { kind: 'chat', planned: false, contentProfile, goals: [] });
    assert.match(classified, /本步仅调用planTurn/);
    assert.match(classified, /历史回复关于缺少配置的说法不是能力依据/);
    assert.match(classified, /"contentProfile":null/);
    assert.doesNotMatch(classified, /当前内容尚未配置教学能力/);
  }
});
