import assert from 'node:assert/strict';
import test from 'node:test';
import { combinedSupport, LearningUpdateError, validateCriteria } from '../src/services/learning-route';
import { assembleSystem } from '../src/agent/context';
import { contentProfileRules, MATH_PROFILE, requireMaterialProfile, UNCONFIGURED_PROFILE } from '../src/agent/content-profile';
import { nativeToolSet } from '../src/agent/tools';
import type { TurnPolicy } from '../src/agent/policy';

const criteria = [{ id: 'reason', description: '能说明判断的理由', requiresIndependent: true }];
const response = [{ criterionId: 'reason', evidenceType: 'reasoning', met: true, quote: '变化量之比不变', feedback: '说明了比值不变' }];
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
