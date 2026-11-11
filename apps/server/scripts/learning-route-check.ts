import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
Object.assign(process.env, { NODE_ENV: 'test' });

/** Own database fixtures and application transactions only. No model, worker or student runtime mocks. */
async function main() {
  const { db } = await import('../src/lib/db');
  const { conversationService } = await import('../src/services/conversation.service');
  const { saveLearningUpdate, learningRouteContext, learningRouteView, actOnLearningRoute } = await import('../src/services/learning-route');
  const { withActiveRun } = await import('../src/agent/run-guard');
  const { MATH_PROFILE, UNCONFIGURED_PROFILE } = await import('../src/agent/content-profile');
  const { subjectService } = await import('../src/services/subject.service');
  type Update = import('../src/agent/learning-contracts').LearningUpdate;
  const user = await db.user.create({ data: { openid: `dev:learning-check-${randomUUID()}` } });
  try {
    const c = await conversationService.create(user.id, { initialText: '想理解斜率的变化率含义', subjectType: 'knowledge' });
    const detail = await conversationService.get(user.id, c.id), s = detail.subject!;
    await db.subjectRevision.update({ where: { id: s.id }, data: { confirmedAt: new Date() } });
    const policy: import('../src/agent/policy').TurnPolicy = { subjectId: s.subjectId, subjectRevisionId: s.id,
      subjectConfirmed: true, stage: 'guiding', allowedTools: [], answerPermission: false, allowSolution: false, teachingMode: 'concept', focus: {} };
    const owner = `fixture-${randomUUID()}`, until = new Date(Date.now() + 3_600_000);
    let stamp = Date.now() - 100_000;
    async function turn(text: string, reply: string) {
      stamp += 100;
      const source = await db.message.create({ data: { conversationId: c.id, subjectId: s.subjectId, subjectRevisionId: s.id,
        role: 'user', status: 'complete', createdAt: new Date(stamp), content: { blocks: [{ type: 'text', text }] } } });
      const run = await db.agentRun.create({ data: { conversationId: c.id, subjectId: s.subjectId, subjectRevisionId: s.id,
        userMessageId: source.id, requestId: randomUUID(), status: 'running', leaseBy: owner, leaseUntil: until, deadlineAt: until, promptVersion: 'learning-check' } });
      const message = await db.message.create({ data: { conversationId: c.id, subjectId: s.subjectId, subjectRevisionId: s.id, runId: run.id,
        role: 'assistant', status: 'complete', createdAt: new Date(stamp + 1), content: { blocks: [{ type: 'text', text: reply }] } } });
      const input: Parameters<typeof saveLearningUpdate>[1] = { revisionId: s.id, conversationId: c.id, userId: user.id, runId: run.id, userMessageId: source.id,
        messageId: message.id, policy, profile: MATH_PROFILE, assistance: 'none' as const };
      return { run, source, apply: (update?: Update, extra: Partial<typeof input> = {}) => withActiveRun(run.id, owner, (tx) => saveLearningUpdate(tx, { ...input, ...extra, update })),
        finish: () => db.agentRun.update({ where: { id: run.id }, data: { status: 'waiting_user' } }) };
    }
    const prompt = '如果横向增加2，纵向增加6，变化量之比是多少？请说明含义。';
    const t1 = await turn('想理解斜率的变化率含义', prompt);
    const route = (await t1.apply({ action: 'create', goal: '理解斜率表示的变化关系', goalQuote: '理解斜率',
      nodes: [{ key: 'ratio', objective: '用变化量之比说明变化快慢', prerequisites: [], criteria: [{ id: 'ratio', description: '能计算并解释纵向与横向变化量之比', requiresIndependent: true }] },
        { key: 'apply', objective: '在新情境中解释相同变化率', prerequisites: ['ratio'], criteria: [{ id: 'apply', description: '能应用到未示范的新情境', requiresIndependent: true }] }],
      initialCheck: { nodeKey: 'ratio', prompt, taskKind: 'explanation' } }))!;
    assert.equal(route.nodes[0]!.status, 'learning');
    assert.equal((await t1.apply())?.version, route.version, '同运行重复保存不重复建路线');
    await t1.finish();
    assert.equal((await learningRouteContext(db, s.id))!.criteria.length, 2);
    const t2 = await turn('变化量之比是3，表示横向每增加1，纵向增加3。', '你已经解释了变化率。');
    const evaluate = (version: number): Update => ({ action: 'update', routeId: route.id, expectedVersion: version,
      check: { action: 'evaluate', checkId: route.nodes[0]!.check!.id, evaluation: 'pass', criteriaResults: [{ criterionId: 'ratio', evidenceType: 'reasoning', met: true,
        quote: '横向每增加1，纵向增加3', feedback: '正确说明比值含义' }] }, node: { id: route.nodes[1]!.id, action: 'learn' } });
    const passed = (await t2.apply(evaluate(route.version)))!;
    assert.equal(passed.nodes[0]!.status, 'checked'); assert.equal(passed.nodes[1]!.status, 'learning');
    assert.equal(await db.learningCheckEvaluation.count({ where: { checkId: route.nodes[0]!.check!.id } }), 1);
    await t2.finish();
    const pause = { requestId: randomUUID(), routeId: passed.id, expectedVersion: passed.version, action: 'pause' as const };
    const paused = (await actOnLearningRoute(user.id, c.id, s.subjectId, pause))!;
    assert.equal(paused.status, 'paused');
    assert.equal((await actOnLearningRoute(user.id, c.id, s.subjectId, pause))!.version, paused.version, '手动重试幂等');
    await assert.rejects(actOnLearningRoute('another-user', c.id, s.subjectId, pause), /不存在/);
    await assert.rejects(actOnLearningRoute(user.id, c.id, s.subjectId, { ...pause, requestId: randomUUID(), action: 'resume' }), /已更新/);
    const resumed = (await actOnLearningRoute(user.id, c.id, s.subjectId, { requestId: randomUUID(), routeId: route.id, expectedVersion: paused.version, action: 'resume' }))!;
    const prompt2 = '如果纵向增加8，横向增加4，请解释变化量之比。';
    const t3 = await turn('继续下一步', prompt2);
    const next = (await t3.apply({ action: 'update', routeId: route.id, expectedVersion: resumed.version,
      check: { action: 'issue', nodeId: route.nodes[1]!.id, prompt: prompt2, taskKind: 'application' } }))!;
    await t3.finish();
    const interrupted = await turn('给一点提示', '可以先看纵向与横向变化量之比。');
    await db.message.updateMany({ where: { runId: interrupted.run.id, role: 'assistant' }, data: { status: 'incomplete' } });
    await db.agentRun.update({ where: { id: interrupted.run.id }, data: { status: 'cancelled' } });
    const afterInterruption = await turn('变化量之比是2', '先核对帮助记录。');
    await assert.rejects(afterInterruption.apply({ action: 'update', routeId: route.id, expectedVersion: next.version,
      check: { action: 'evaluate', checkId: next.nodes[1]!.check!.id, evaluation: 'pass', criteriaResults: [{ criterionId: 'apply', evidenceType: 'application', met: true, quote: '变化量之比是2', feedback: '正确' }] } }), /复述/);
    await afterInterruption.finish();
    const hint = await turn('给我讲解一下', '先计算8除以4。');
    const helped = (await hint.apply(undefined, { assistance: 'explanation' }))!;
    assert.equal(helped.nodes[1]!.check!.supportLevel, 'explained');
    await hint.finish();
    const replay = await turn('变化量之比是2', '这次不能当作独立验证。');
    await assert.rejects(replay.apply({ action: 'update', routeId: route.id, expectedVersion: helped.version,
      check: { action: 'evaluate', checkId: next.nodes[1]!.check!.id, evaluation: 'pass', criteriaResults: [{ criterionId: 'apply', evidenceType: 'application', met: true, quote: '变化量之比是2', feedback: '正确' }] } }), /复述/);
    assert.equal((await learningRouteView(db, s.id))!.nodes[1]!.status, 'learning', '非法评价事务回滚');
    await assert.rejects(replay.apply({ action: 'update', routeId: route.id, expectedVersion: helped.version,
      check: { action: 'evaluate', checkId: route.nodes[0]!.check!.id, evaluation: 'pass', criteriaResults: [{ criterionId: 'ratio', evidenceType: 'reasoning', met: true, quote: '伪造的学生回答', feedback: '不应写入' }] } }), /只读|实际回答/);
    await assert.rejects(replay.apply({ action: 'update', routeId: route.id, expectedVersion: helped.version }, { profile: UNCONFIGURED_PROFILE }), /未配置|当前内容/);
    await db.agentRun.update({ where: { id: replay.run.id }, data: { status: 'cancelled' } });
    await assert.rejects(replay.apply(), /停止/);
    const skipped = (await actOnLearningRoute(user.id, c.id, s.subjectId, { requestId: randomUUID(), routeId: route.id,
      expectedVersion: helped.version, action: 'skip', nodeId: route.nodes[1]!.id }))!;
    assert.equal(skipped.nodes[1]!.status, 'skipped');
    assert.equal(skipped.nodes.filter((n) => n.status === 'checked').length, 1, '跳过不计作验证通过');
    const old = await db.learningCheckEvaluation.count({ where: { checkId: route.nodes[0]!.check!.id } });
    await subjectService.update(user.id, c.id, { action: 'update', subjectId: s.subjectId, expectedRevision: 1, content: { text: '新的学习目标' } });
    const revised = await conversationService.get(user.id, c.id);
    assert.equal(revised.learningRoute, null, '新题干版本不继承已通过状态');
    assert.equal(await db.learningCheckEvaluation.count({ where: { checkId: route.nodes[0]!.check!.id } }), old, '旧证据保留');
    console.log('PASS learning routes: create/source/rubric, check-before-answer, independent evidence, next node, replay, pause/resume/CAS/ownership, help provenance, invalid-write rollback, cancellation, skip, revision isolation/history; no GPT calls');
  } finally { await db.user.delete({ where: { id: user.id } }); await db.$disconnect(); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
