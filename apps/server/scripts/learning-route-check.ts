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
        role: 'assistant', status: 'complete', createdAt: new Date(stamp + 1), content: { blocks: [{ type: 'text', text: reply }], learningAssistance: 'none' } } });
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
    assert.equal(route.currentNodeId, route.nodes[0]!.id);
    assert.equal((await t1.apply())?.version, route.version, '同运行重复保存不重复建路线');
    await t1.finish();
    assert.equal((await learningRouteContext(db, s.id))!.criteria.length, 2);
    const prompt2 = '如果纵向增加8，横向增加4，请解释变化量之比。';
    const t2 = await turn('变化量之比是3，表示横向每增加1，纵向增加3。', `你已经解释了变化率。${prompt2}`);
    const evaluate = (version: number): Update => ({ action: 'update', routeId: route.id, expectedVersion: version,
      check: { action: 'evaluate', checkId: route.nodes[0]!.check!.id, evaluation: 'pass', criteriaResults: [{ criterionId: 'ratio', evidenceType: 'reasoning', met: true,
        quote: '横向每增加1，纵向增加3', feedback: '正确说明比值含义' }] },
      followupCheck: { nodeId: route.nodes[1]!.id, prompt: prompt2, taskKind: 'application' } });
    await assert.rejects(t2.apply({ ...evaluate(route.version), action: 'update', routeId: route.id, expectedVersion: route.version,
      followupCheck: { nodeId: route.nodes[0]!.id, prompt: prompt2, taskKind: 'application' } }), /实际继续的节点/);
    await assert.rejects(t2.apply({ ...evaluate(route.version), action: 'update', routeId: route.id, expectedVersion: route.version,
      followupCheck: { nodeId: route.nodes[1]!.id, prompt: '这段验证任务并没有显示给学生。', taskKind: 'application' } }), /原样展示/);
    assert.equal(await db.learningCheckEvaluation.count({ where: { checkId: route.nodes[0]!.check!.id } }), 0, '后续题非法时旧题评价也须回滚');
    assert.equal((await learningRouteView(db, s.id))!.nodes[0]!.status, 'learning');
    const passed = (await t2.apply(evaluate(route.version)))!;
    assert.equal(passed.nodes[0]!.status, 'checked'); assert.equal(passed.nodes[1]!.status, 'learning');
    assert.equal(passed.currentNodeId, route.nodes[1]!.id);
    assert.equal(passed.nodes[1]!.check!.prompt, prompt2, '本次推进即保存下一道题');
    assert.equal(passed.nodes[1]!.check!.supportLevel, 'independent');
    assert.equal(await db.learningCheckEvaluation.count({ where: { checkId: route.nodes[0]!.check!.id } }), 1);
    assert.equal((await t2.apply(evaluate(route.version)))!.version, passed.version, '同运行重复提交评价和下一题应幂等');
    assert.equal(await db.learningCheck.count({ where: { nodeId: route.nodes[1]!.id } }), 1, '重试不能重复创建下一题');
    await t2.finish();
    const pause = { requestId: randomUUID(), routeId: passed.id, expectedVersion: passed.version, action: 'pause' as const };
    const paused = (await actOnLearningRoute(user.id, c.id, s.subjectId, pause))!;
    assert.equal(paused.status, 'paused');
    assert.equal((await actOnLearningRoute(user.id, c.id, s.subjectId, pause))!.version, paused.version, '手动重试幂等');
    await assert.rejects(actOnLearningRoute('another-user', c.id, s.subjectId, pause), /不存在/);
    await assert.rejects(actOnLearningRoute(user.id, c.id, s.subjectId, { ...pause, requestId: randomUUID(), action: 'resume' }), /已更新/);
    const resumed = (await actOnLearningRoute(user.id, c.id, s.subjectId, { requestId: randomUUID(), routeId: route.id, expectedVersion: paused.version, action: 'resume' }))!;
    const next = resumed;
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
      check: { action: 'evaluate', checkId: route.nodes[0]!.check!.id, evaluation: 'pass', criteriaResults: [{ criterionId: 'ratio', evidenceType: 'reasoning', met: true, quote: '伪造的学生回答', feedback: '不应写入' }] } }), /只读|实际回答|当前有效/);
    await assert.rejects(replay.apply({ action: 'update', routeId: route.id, expectedVersion: helped.version }, { profile: UNCONFIGURED_PROFILE }), /未配置|当前内容/);
    await db.agentRun.update({ where: { id: replay.run.id }, data: { status: 'cancelled' } });
    await assert.rejects(replay.apply(), /停止/);
    const skipped = (await actOnLearningRoute(user.id, c.id, s.subjectId, { requestId: randomUUID(), routeId: route.id,
      expectedVersion: helped.version, action: 'skip', nodeId: route.nodes[1]!.id }))!;
    assert.equal(skipped.nodes[1]!.status, 'skipped');
    assert.equal(skipped.nodes.filter((n) => n.status === 'checked').length, 1, '跳过不计作验证通过');
    assert.equal(skipped.currentNodeId, null, '全部通过或跳过后没有伪造当前节点');

    const visit = { requestId: randomUUID(), routeId: route.id, expectedVersion: skipped.version, action: 'revisit' as const, nodeId: route.nodes[1]!.id };
    const revisited = (await actOnLearningRoute(user.id, c.id, s.subjectId, visit))!;
    assert.equal(revisited.currentNodeId, route.nodes[1]!.id);
    assert.equal(revisited.nodes[1]!.status, 'learning');
    assert.equal(revisited.nodes[1]!.check, null, '回访不用旧验证继续判分');
    assert.equal((await actOnLearningRoute(user.id, c.id, s.subjectId, visit))!.version, revisited.version, '回访请求重试不重复修改');
    assert.equal((await db.learningCheck.findUniqueOrThrow({ where: { id: next.nodes[1]!.check!.id } })).status, 'superseded');

    const returnPrompt = '水位每4分钟升高12厘米，怎样解释它的平均变化率？';
    const returnTurn = await turn('回来继续刚才跳过的应用', returnPrompt);
    await assert.rejects(returnTurn.apply({ action: 'update', routeId: route.id, expectedVersion: revisited.version,
      check: { action: 'evaluate', checkId: next.nodes[1]!.check!.id, evaluation: 'needs_review', criteriaResults: [{ criterionId: 'apply', evidenceType: 'unclear', met: false, quote: '', feedback: '不能评价旧题' }] } }), /当前有效/);
    const returning = (await returnTurn.apply({ action: 'update', routeId: route.id, expectedVersion: revisited.version,
      check: { action: 'issue', nodeId: route.nodes[1]!.id, prompt: returnPrompt, taskKind: 'application' } }))!;
    await returnTurn.finish();
    assert.notEqual(returning.nodes[1]!.check!.id, next.nodes[1]!.check!.id);

    const revisitChecked = await turn('第一步我又忘了，想重新理解', '先回来巩固，再用新的情境验证。');
    await assert.rejects(revisitChecked.apply({ action: 'update', routeId: route.id, expectedVersion: returning.version,
      node: { id: route.nodes[0]!.id, action: 'revisit' } }), /当前请求依据/);
    const relearning = (await revisitChecked.apply({ action: 'update', routeId: route.id, expectedVersion: returning.version,
      studentQuote: '第一步我又忘了', node: { id: route.nodes[0]!.id, action: 'revisit' } }))!;
    await revisitChecked.finish();
    assert.equal(relearning.currentNodeId, route.nodes[0]!.id);
    assert.equal(relearning.nodes[0]!.status, 'needs_review');
    assert.equal(relearning.nodes[0]!.check, null);
    assert.equal(relearning.nodes[1]!.check!.id, returning.nodes[1]!.check!.id, '换回旧节点不删除其他节点待回答任务');
    assert.equal(await db.learningCheckEvaluation.count({ where: { checkId: route.nodes[0]!.check!.id, evaluation: 'pass' } }), 1, '历史通过证据仍保留');

    const duplicate = await turn('重新验证第一步', prompt);
    await assert.rejects(duplicate.apply({ action: 'update', routeId: route.id, expectedVersion: relearning.version,
      check: { action: 'issue', nodeId: route.nodes[0]!.id, prompt, taskKind: 'explanation' } }), /不能复用原题/);
    await duplicate.finish();
    const retryPrompt = '步行路程每3分钟增加240米，请解释单位时间的变化量。';
    const fresh = await turn('换一个没做过的例子', retryPrompt);
    const recheck = (await fresh.apply({ action: 'update', routeId: route.id, expectedVersion: relearning.version,
      check: { action: 'issue', nodeId: route.nodes[0]!.id, prompt: retryPrompt, taskKind: 'application' } }))!;
    await fresh.finish();
    const corrected = await turn('每分钟增加80米，因为240除以3等于80。', '你给出了单位时间的变化量。');
    const repassed = (await corrected.apply({ action: 'update', routeId: route.id, expectedVersion: recheck.version,
      check: { action: 'evaluate', checkId: recheck.nodes[0]!.check!.id, evaluation: 'pass', criteriaResults: [{ criterionId: 'ratio', evidenceType: 'application', met: true, quote: '每分钟增加80米', feedback: '正确解释单位时间变化量' }] } }))!;
    await corrected.finish();
    assert.equal(repassed.nodes[0]!.status, 'checked');
    assert.equal(repassed.currentNodeId, route.nodes[1]!.id, '再验证后回到仍未完成的节点');
    assert.equal(await db.learningCheckEvaluation.count({ where: { check: { nodeId: route.nodes[0]!.id }, evaluation: 'pass' } }), 2, '新旧通过证据并存');

    const applicationCheck = repassed.nodes[1]!.check!;
    const mistaken = await turn('平均变化率是12，因为只看增加的高度就够了。', '比较高度增加量和经过的时间，再检查单位。');
    const struggling = (await mistaken.apply({ action: 'update', routeId: route.id, expectedVersion: repassed.version,
      check: { action: 'evaluate', checkId: applicationCheck.id, evaluation: 'needs_review', criteriaResults: [
        { criterionId: 'apply', met: false, evidenceType: 'reasoning', quote: '只看增加的高度就够了', feedback: '没有结合经过时间解释平均变化率' },
      ] } }, { assistance: 'hint' }))!;
    await mistaken.finish();
    assert.equal(struggling.nodes[1]!.status, 'needs_review');
    assert.equal(struggling.nodes[1]!.check!.supportLevel, 'hinted');
    assert.equal(struggling.currentNodeId, route.nodes[1]!.id);

    const selfReport = await turn('我懂了，但还不太确定。', '可以继续尝试说明每分钟的变化。');
    const uncertainResult = { criterionId: 'apply', met: false, evidenceType: 'self_report' as const, quote: '我懂了', feedback: '尚未提供本题判断和理由' };
    await assert.rejects(selfReport.apply({ action: 'update', routeId: route.id, expectedVersion: struggling.version,
      check: { action: 'evaluate', checkId: applicationCheck.id, evaluation: 'needs_review', criteriaResults: [uncertainResult] } }), /明确证据/);
    const uncertain = (await selfReport.apply({ action: 'update', routeId: route.id, expectedVersion: struggling.version,
      check: { action: 'evaluate', checkId: applicationCheck.id, evaluation: 'insufficient_evidence', criteriaResults: [uncertainResult] } }, { assistance: 'none' }))!;
    await selfReport.finish();
    assert.equal(uncertain.nodes[1]!.status, 'needs_review', '依据不足保留原节点状态，不制造新失败或通过');
    assert.equal(uncertain.nodes[1]!.check!.supportLevel, 'hinted', '自述不能清除既有帮助');

    const freshApplication = '水箱每5分钟增加20升水，请解释平均每分钟的变化量及理由。';
    const correctedWithHelp = await turn('平均每分钟升高3厘米，因为12除以4等于3。', `你修正了计算，但本题得到过提示。${freshApplication}`);
    const helpedEvaluation = { action: 'evaluate' as const, checkId: applicationCheck.id, evaluation: 'pass' as const, criteriaResults: [
      { criterionId: 'apply', met: true, evidenceType: 'application' as const, quote: '每分钟升高3厘米', feedback: '正确解释了单位时间的变化量' },
    ] };
    await assert.rejects(correctedWithHelp.apply({ action: 'update', routeId: route.id, expectedVersion: uncertain.version,
      check: helpedEvaluation }), /独立完成/);
    const freshApplicationRoute = (await correctedWithHelp.apply({ action: 'update', routeId: route.id, expectedVersion: uncertain.version,
      check: { ...helpedEvaluation, evaluation: 'insufficient_evidence' },
      followupCheck: { nodeId: route.nodes[1]!.id, prompt: freshApplication, taskKind: 'application' } }, { assistance: 'explanation' }))!;
    await correctedWithHelp.finish();
    assert.equal(freshApplicationRoute.nodes[1]!.status, 'needs_review');
    assert.equal(freshApplicationRoute.nodes[1]!.check!.supportLevel, 'independent', '旧题得到帮助不污染未示范的新题');
    assert.equal((await db.learningCheck.findUniqueOrThrow({ where: { id: applicationCheck.id } })).supportLevel, 'hinted', '旧题帮助仍保留');

    const independentApplication = await turn('每分钟增加4升，因为20除以5等于4。', '本次两个目标都通过了验证。');
    const completed = (await independentApplication.apply({ action: 'update', routeId: route.id, expectedVersion: freshApplicationRoute.version,
      check: { action: 'evaluate', checkId: freshApplicationRoute.nodes[1]!.check!.id, evaluation: 'pass', criteriaResults: [
        { criterionId: 'apply', met: true, evidenceType: 'application', quote: '每分钟增加4升', feedback: '独立在新情境中解释单位时间变化量' },
      ] } }))!;
    await independentApplication.finish();
    assert.ok(completed.nodes.every((n) => n.status === 'checked'));
    assert.equal(completed.currentNodeId, null, '全部通过后清除当前待学焦点');
    const completedPause = (await actOnLearningRoute(user.id, c.id, s.subjectId, { requestId: randomUUID(), routeId: route.id,
      expectedVersion: completed.version, action: 'pause' }))!;
    const completedResume = (await actOnLearningRoute(user.id, c.id, s.subjectId, { requestId: randomUUID(), routeId: route.id,
      expectedVersion: completedPause.version, action: 'resume' }))!;
    assert.equal(completedResume.currentNodeId, null);
    assert.ok(completedResume.nodes.every((n) => n.status === 'checked'), '全部通过后暂停/恢复不伪造新焦点或清除证据');
    const old = await db.learningCheckEvaluation.count({ where: { checkId: route.nodes[0]!.check!.id } });
    await subjectService.update(user.id, c.id, { action: 'update', subjectId: s.subjectId, expectedRevision: 1, content: { text: '新的学习目标' } });
    const revised = await conversationService.get(user.id, c.id);
    assert.equal(revised.learningRoute, null, '新题干版本不继承已通过状态');
    assert.equal(await db.learningCheckEvaluation.count({ where: { checkId: route.nodes[0]!.check!.id } }), old, '旧证据保留');
    console.log('PASS learning routes: create/source/rubric, check-before-answer, atomic evaluation/followup rollback, wrong-answer evidence, self-report uncertainty, hinted correction/fresh independent transfer, all-checked completion, explicit focus, pause/resume/CAS/ownership, help provenance, cancellation, skip/revisit, immutable prior checks, fresh revalidation, history/revision isolation; no GPT calls');
  } finally { await db.user.delete({ where: { id: user.id } }); await db.$disconnect(); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
