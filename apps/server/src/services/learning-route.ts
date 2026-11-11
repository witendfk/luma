import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { LearningNodeStatus, LearningSupport, LearningVerdict, type LearningRouteAction, type LearningRouteView } from '@luma/shared';
import { db } from '../lib/db';
import { invalidFormat, notFound, revisionConflict } from '../lib/errors';
import { assertIdle, latestRevision, resolveSubject } from './subject-context';
import { LearningUpdate, PassCriteria } from '../agent/learning-contracts';
import type { TurnPolicy } from '../agent/policy';
import type { ContentProfileRef } from '../agent/content-profile';
import { textOf } from '../agent/blocks';

const include = { nodes: { orderBy: { position: 'asc' as const }, include: {
  checks: { where: { status: 'active' }, orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }], take: 1,
    include: { evaluations: { orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }], take: 1 } } },
} } };
type Route = Prisma.LearningRouteGetPayload<{ include: typeof include }>;
export class LearningUpdateError extends Error {}
function requireFact(condition: unknown, message: string): asserts condition {
  if (!condition) throw new LearningUpdateError(message);
}
function quoted(text: string, quote: string) { return Boolean(quote.trim()) && text.includes(quote); }

/** Keep a stable focus even when another node still needs review. Never erase its evidence. */
function nextNode(route: Route, excluding?: string): string | null {
  return route.nodes.find((n) => n.id !== excluding && ['learning', 'needs_review', 'pending'].includes(n.status))?.id ?? null;
}

/** Focus and node state must agree, including when a prior version left it pending. */
async function focusNode(tx: Prisma.TransactionClient, route: Route, nodeId: string | null) {
  if (nodeId) await tx.learningRouteNode.updateMany({ where: { id: nodeId, routeId: route.id, status: 'pending' },
    data: { status: 'learning', version: { increment: 1 } } });
  return tx.learningRoute.update({ where: { id: route.id }, data: { currentNodeId: nodeId }, include });
}

async function revisitNode(tx: Prisma.TransactionClient, route: Route, nodeId: string) {
  const node = route.nodes.find((n) => n.id === nodeId);
  requireFact(node && ['checked', 'skipped'].includes(node.status), '请选择已跳过或已通过的节点重新学习');
  await tx.learningCheck.updateMany({ where: { nodeId, status: 'active' }, data: { status: 'superseded' } });
  await tx.learningRouteNode.update({ where: { id: nodeId }, data: {
    status: node.status === 'checked' ? 'needs_review' : 'learning', version: { increment: 1 },
  } });
  await tx.learningRoute.update({ where: { id: route.id }, data: { currentNodeId: nodeId } });
}

function project(row: Route): LearningRouteView {
  return { id: row.id, version: row.version, goal: row.goal,
    status: row.status as LearningRouteView['status'], subjectRevisionId: row.subjectRevisionId,
    contentProfileId: row.contentProfileId, contentProfileVersion: row.contentProfileVersion, createdAt: row.createdAt.toISOString(),
    currentNodeId: row.currentNodeId,
    nodes: row.nodes.map((n) => {
      const c = n.checks[0], evaluation = c?.evaluations[0];
      return { id: n.id, objective: n.objective, position: n.position, status: LearningNodeStatus.parse(n.status), version: n.version,
        check: c ? { id: c.id, prompt: c.prompt, evaluation: evaluation ? LearningVerdict.parse(evaluation.evaluation) : null,
          supportLevel: LearningSupport.parse(c.supportLevel) } : null };
    }) };
}
export async function learningRouteView(tx: Prisma.TransactionClient, revisionId?: string | null) {
  if (!revisionId) return null;
  const row = await tx.learningRoute.findFirst({ where: { subjectRevisionId: revisionId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include });
  return row ? project(row) : null;
}

/** Rubrics contain observable criteria, never a reference solution. Only the current check is loaded. */
export async function learningRouteContext(tx: Prisma.TransactionClient, revisionId?: string | null) {
  const view = await learningRouteView(tx, revisionId);
  if (!view) return null;
  const nodes = await tx.learningRouteNode.findMany({ where: { routeId: view.id }, select: { id: true, key: true, prerequisites: true, passCriteria: true } });
  return { ...view, criteria: nodes.map((n) => ({ nodeId: n.id, key: n.key, prerequisites: n.prerequisites, criteria: n.passCriteria })) };
}

const rank = ['independent', 'hinted', 'explained', 'solution_seen'] as const;
export function combinedSupport(previous: string, help: 'none' | 'hint' | 'explanation' | 'solution') {
  const next = { none: 0, hint: 1, explanation: 2, solution: 3 }[help];
  return rank[Math.max(rank.indexOf(previous as typeof rank[number]), next)]!;
}

/** Same-object reading during an unanswered check is assistance, not independent evidence. */
export async function recordRouteReading(tx: Prisma.TransactionClient, revisionId: string, navigationKey: string) {
  const route = await tx.learningRoute.findFirst({ where: { subjectRevisionId: revisionId, status: 'active' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include });
  if (!route) return;
  const checks = route.nodes.filter((n) => n.id === route.currentNodeId)
    .flatMap((n) => n.checks).filter((c) => c.evaluations[0]?.evaluation !== 'pass' && ['independent', 'hinted'].includes(c.supportLevel));
  if (!checks.length) return;
  for (const check of checks) await tx.learningCheck.update({ where: { id: check.id }, data: { supportLevel: 'explained' } });
  await tx.learningRoute.update({ where: { id: route.id }, data: { version: { increment: 1 } } });
  await tx.learningRouteEvent.create({ data: { routeId: route.id, version: route.version + 1,
    requestId: `reading:${navigationKey}`, changes: { assistance: 'explanation', source: 'reader_navigation' } } });
}
export function validateCriteria(raw: unknown, results: Array<{ criterionId: string; evidenceType: string; met: boolean; quote: string; feedback: string }>, text: string, support: string, verdict: string) {
  const criteria = PassCriteria.parse(raw);
  requireFact(new Set(results.map((r) => r.criterionId)).size === criteria.length && results.length === criteria.length,
    '评价必须逐项覆盖已保存的验证条件，不能新增或遗漏条件');
  for (const result of results) {
    requireFact(criteria.some((c) => c.id === result.criterionId), '验证条件版本不匹配');
    requireFact(!result.quote || quoted(text, result.quote), '评价引用必须来自本轮学生的实际回答');
    if (result.met) requireFact(quoted(text, result.quote), '满足条件必须有学生回答中的逐字证据');
  }
  if (verdict === 'needs_review') {
    requireFact(results.some((r) => !r.met && quoted(text, r.quote) && !['self_report', 'repetition', 'unclear'].includes(r.evidenceType)),
      '需巩固必须有实际作答中未满足条件的明确证据；自述、未作答或不确定请记依据不足/不确定，不当作答错');
  }
  if (verdict === 'pass') {
    requireFact(results.every((r) => r.met), '没有满足全部条件，不能标记验证通过');
    requireFact(results.every((r) => !['self_report', 'repetition', 'unclear'].includes(r.evidenceType)), '自述、复述或不明确证据不能作为理解验证通过依据');
    requireFact(!['explained', 'solution_seen', 'skipped'].includes(support), '看过讲解/解析后的复述不能单独作为通过依据，请换一个未示范的验证');
    requireFact(!criteria.some((c) => c.requiresIndependent && support !== 'independent'), '本验证要求独立完成，提示后需另设验证');
  }
}

async function issueCheck(tx: Prisma.TransactionClient, route: Route, nodeId: string,
  task: { prompt: string; taskKind: string }, sourceRunId: string, messageId: string) {
  const node = route.nodes.find((n) => n.id === nodeId);
  requireFact(node && !['checked', 'skipped'].includes(node.status), '只能针对当前未通过/未跳过的节点设置验证');
  const previous = node.checks[0];
  requireFact(!previous || previous.evaluations.length > 0, '该节点已有待回答验证，请先处理，不能重复出题');
  const historical = await tx.learningCheck.findFirst({ where: { nodeId, prompt: task.prompt.trim() } });
  requireFact(!historical, '重新验证应换一个未示范的任务，不能复用原题作为新证据');
  const reply = await tx.message.findUnique({ where: { id: messageId } });
  requireFact(reply && textOf(reply.content).includes(task.prompt), '短验证任务必须原样展示在本次教学正文中');
  await tx.learningCheck.updateMany({ where: { nodeId, status: 'active' }, data: { status: 'superseded' } });
  await tx.learningCheck.create({ data: { nodeId, sourceRunId, issuedMessageId: messageId,
    prompt: task.prompt, taskKind: task.taskKind, rubricVersion: `${route.contentProfileId}@${route.contentProfileVersion}:1`,
    criteria: PassCriteria.parse(node.passCriteria) as Prisma.InputJsonValue } });
}

/** Called ONLY within withActiveRun's conversation transaction, after a complete reply is available. */
export async function saveLearningUpdate(tx: Prisma.TransactionClient, input: {
  revisionId: string; conversationId: string; userId: string; runId: string; userMessageId: string | null;
  messageId: string; policy: TurnPolicy; profile: ContentProfileRef; update?: LearningUpdate;
  assistance?: 'none' | 'hint' | 'explanation' | 'solution';
}) {
  if (!input.userMessageId || !input.policy.subjectConfirmed) {
    requireFact(!input.update, '先确认学习范围，再保存路线'); return null;
  }
  if (input.profile.id !== 'math') { requireFact(!input.update, '当前内容未配置伴学路线能力'); return null; }
  if (input.policy.focus.attemptId || input.policy.focus.sectionId) requireFact(!input.update, '局部追问不更新独立伴学路线');
  const source = await tx.message.findFirst({ where: { id: input.userMessageId, conversationId: input.conversationId,
    subjectRevisionId: input.revisionId, role: 'user', status: 'complete', conversation: { userId: input.userId } } });
  requireFact(source, '学习更新缺少本轮学生原文');
  const text = textOf(source.content), update = input.update ? LearningUpdate.parse(input.update) : undefined;
  const eventKey = `run:${input.runId}:learning`;
  if (await tx.learningRouteEvent.findUnique({ where: { requestId: eventKey } })) return learningRouteView(tx, input.revisionId);
  let route = await tx.learningRoute.findFirst({ where: { subjectRevisionId: input.revisionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include });
  if (!update) {
    if (!route || route.status !== 'active') return null;
    // Missing metadata is conservatively counted as explanation, never independent success.
    const help = input.policy.allowSolution ? 'solution' : input.assistance ?? 'explanation';
    const currentNodeId = route.currentNodeId;
    const open = route.nodes.filter((n) => n.id === currentNodeId).flatMap((n) => n.checks).filter((c) => c.evaluations[0]?.evaluation !== 'pass' && c.sourceRunId !== input.runId);
    const changed = open.filter((c) => combinedSupport(c.supportLevel, help) !== c.supportLevel);
    for (const check of changed) await tx.learningCheck.update({ where: { id: check.id }, data: { supportLevel: combinedSupport(check.supportLevel, help) } });
    if (!changed.length) return null;
    await tx.learningRoute.update({ where: { id: route.id }, data: { version: { increment: 1 } } });
    await tx.learningRouteEvent.create({ data: { routeId: route.id, version: route.version + 1, requestId: eventKey, sourceMessageId: source.id, changes: { assistance: help } } });
    return learningRouteView(tx, input.revisionId);
  }
  requireFact(!input.policy.allowSolution, '完整解析回合不创建/通过独立理解验证');
  if (update.action === 'create') {
    requireFact(quoted(text, update.goalQuote), '学习目标必须引用学生当前请求，不能擅自扩展课程');
    const keys = update.nodes.map((n) => n.key);
    requireFact(new Set(keys).size === keys.length, '学习节点key重复');
    update.nodes.forEach((node, i) => requireFact(node.prerequisites.every((key) => keys.slice(0, i).includes(key)), '前置节点必须属于本路线且排在当前节点之前'));
    if (route && route.status !== 'ended') {
      requireFact(update.replaces?.routeId === route.id && update.replaces.expectedVersion === route.version, '已有学习路线，应继续当前路线；改目标时明确引用被替代路线版本');
      await tx.learningRoute.update({ where: { id: route.id }, data: { status: 'ended', version: { increment: 1 } } });
      await tx.learningRouteEvent.create({ data: { routeId: route.id, version: route.version + 1, requestId: `${eventKey}:end`, sourceMessageId: source.id,
        changes: { status: 'ended', reason: 'goal_changed', quote: update.goalQuote } } });
    }
    route = await tx.learningRoute.create({ data: { subjectRevisionId: input.revisionId, goal: update.goal,
      sourceRunId: input.runId, sourceMessageId: source.id, sourceQuote: update.goalQuote,
      contentProfileId: input.profile.id, contentProfileVersion: input.profile.version,
      nodes: { create: update.nodes.map((n, i) => ({ key: n.key, objective: n.objective, position: i,
        prerequisites: n.prerequisites, status: i === 0 ? 'learning' : 'pending', passCriteria: n.criteria as Prisma.InputJsonValue })) } }, include });
    route = await tx.learningRoute.update({ where: { id: route.id }, data: { currentNodeId: route.nodes[0]!.id }, include });
    if (update.initialCheck) {
      const node = route.nodes.find((n) => n.key === update.initialCheck!.nodeKey);
      requireFact(node && node.status === 'learning', '首次短验证应对应当前学习节点');
      await issueCheck(tx, route, node.id, update.initialCheck, input.runId, input.messageId);
    }
  } else {
    requireFact(route && route.id === update.routeId && route.version === update.expectedVersion, '路线或版本已变化，请读取当前状态后更新');
    requireFact(route.contentProfileId === input.profile.id && route.contentProfileVersion === input.profile.version, '内容配置版本不匹配，不能继承已通过状态');
    requireFact(route.status !== 'ended', '已结束路线只读');
    requireFact(update.status || update.node || update.check, '没有提出有效的学习更新');
    if (update.status || ['skip', 'revisit'].includes(update.node?.action ?? '')) requireFact(update.studentQuote && quoted(text, update.studentQuote), '暂停、恢复、结束、跳过或回访需要学生当前请求依据');
    requireFact(route.status === 'active' || update.status === 'active' || (!update.node && !update.check), '路线已暂停，请先恢复');
    route = await focusNode(tx, route, route.currentNodeId);
    if (update.check?.action === 'evaluate') {
      const check = await tx.learningCheck.findFirst({ where: { id: update.check.checkId, node: { routeId: route.id } }, include: { node: true, evaluations: { orderBy: { createdAt: 'desc' }, take: 1 } } });
      requireFact(check && check.status === 'active' && check.nodeId === route.currentNodeId && !['skipped', 'pending'].includes(check.node.status), '验证不属于当前有效学习节点');
      requireFact(route.nodes.find((n) => n.id === check.nodeId)?.checks[0]?.id === check.id, '旧验证已被新任务替代，不能用旧题推进当前节点');
      requireFact(!check.evaluations.some((e) => e.evaluation === 'pass'), '已通过验证只读，请设置新的验证任务');
      const issued = await tx.message.findUnique({ where: { id: check.issuedMessageId } });
      requireFact(issued && (source.createdAt > issued.createdAt || (source.createdAt.getTime() === issued.createdAt.getTime() && source.id > issued.id)), '不能用设置验证之前的回答证明验证通过');
      requireFact(!(await tx.learningCheckEvaluation.findUnique({ where: { checkId_attemptMessageId: { checkId: check.id, attemptMessageId: source.id } } })), '本次学生回答已评价，不得重复累计');
      // Interrupted/legacy replies may have exposed help without committing route metadata.
      const replies = await tx.message.findMany({ where: { conversationId: input.conversationId, subjectRevisionId: input.revisionId,
        role: 'assistant', id: { not: issued.id }, AND: [
          { OR: [{ createdAt: { gt: issued.createdAt } }, { createdAt: issued.createdAt, id: { gt: issued.id } }] },
          { OR: [{ createdAt: { lt: source.createdAt } }, { createdAt: source.createdAt, id: { lt: source.id } }] },
        ] }, select: { content: true, status: true } });
      let support = check.supportLevel;
      for (const reply of replies) {
        if (!textOf(reply.content).trim()) continue;
        const metadata = reply.content as { learningAssistance?: 'none' | 'hint' | 'explanation' | 'solution'; containsSolution?: boolean };
        support = combinedSupport(support, metadata.containsSolution ? 'solution' : reply.status === 'incomplete' ? 'explanation' : metadata.learningAssistance ?? 'explanation');
      }
      validateCriteria(check.criteria, update.check.criteriaResults, text, support, update.check.evaluation);
      await tx.learningCheckEvaluation.create({ data: { checkId: check.id, runId: input.runId, attemptMessageId: source.id,
        answerSnapshot: text, evaluation: update.check.evaluation, supportLevel: support,
        criteriaResults: update.check.criteriaResults as Prisma.InputJsonValue } });
      const status = update.check.evaluation === 'pass' ? 'checked' : update.check.evaluation === 'needs_review' ? 'needs_review' : check.node.status;
      await tx.learningRouteNode.update({ where: { id: check.nodeId }, data: { status, version: { increment: 1 } } });
      await tx.learningCheck.update({ where: { id: check.id }, data: { supportLevel: support } });
    }
    if (update.node) {
      route = await tx.learningRoute.findUniqueOrThrow({ where: { id: route.id }, include });
      const node = route.nodes.find((n) => n.id === update.node!.id);
      requireFact(node, '节点不属于当前路线');
      if (update.node.action === 'revisit') {
        await revisitNode(tx, route, node.id);
      } else {
        requireFact(!['checked', 'skipped'].includes(node.status), '已通过/跳过节点请使用revisit，保留旧验证并重新设置任务');
        await tx.learningRouteNode.update({ where: { id: node.id }, data: { status: update.node.action === 'skip' ? 'skipped' : node.status === 'needs_review' ? 'needs_review' : 'learning', version: { increment: 1 } } });
        await focusNode(tx, route, update.node.action === 'learn' ? node.id : route.currentNodeId === node.id ? nextNode(route, node.id) : route.currentNodeId);
      }
      route = await tx.learningRoute.findUniqueOrThrow({ where: { id: route.id }, include });
    }
    if (update.check?.action === 'issue') {
      const nodeId = update.check.nodeId;
      const node = route.nodes.find((n) => n.id === nodeId);
      requireFact(node?.id === route.currentNodeId && (node?.status === 'learning' || node?.status === 'needs_review'), '先确定当前学习节点，再设置短验证');
      await issueCheck(tx, route, update.check.nodeId, update.check, input.runId, input.messageId);
    }
    if (update.followupCheck) {
      // Evaluate the answer and issue the next task in this transaction. A failed
      // follow-up must roll back the evaluation too, rather than strand a question.
      route = await tx.learningRoute.findUniqueOrThrow({ where: { id: route.id }, include });
      const focusedId = route.currentNodeId;
      const current = route.nodes.find((n) => n.id === focusedId);
      const nextId = current && !['checked', 'skipped'].includes(current.status) ? current.id : nextNode(route);
      requireFact(nextId === update.followupCheck.nodeId, '后续短验证必须属于评价后实际继续的节点');
      route = await focusNode(tx, route, nextId);
      await issueCheck(tx, route, update.followupCheck.nodeId, update.followupCheck, input.runId, input.messageId);
    }
    route = await tx.learningRoute.findUniqueOrThrow({ where: { id: route.id }, include });
    const currentNodeId = route.currentNodeId;
    const current = route.nodes.find((n) => n.id === currentNodeId);
    await focusNode(tx, route, !current || ['checked', 'skipped'].includes(current.status) ? nextNode(route) : currentNodeId);
    await tx.learningRoute.update({ where: { id: route.id }, data: { ...(update.status ? { status: update.status } : {}),
      version: { increment: 1 } } });
    route = await tx.learningRoute.findUniqueOrThrow({ where: { id: route.id }, include });
    // Current assistance follows the answer, so cannot retroactively contaminate its evaluation.
    const help = input.assistance ?? 'explanation';
    const focusedNodeId = route.currentNodeId;
    for (const check of route.nodes.filter((n) => n.id === focusedNodeId).flatMap((n) => n.checks).filter((c) => c.sourceRunId !== input.runId && c.evaluations[0]?.evaluation !== 'pass')) {
      await tx.learningCheck.update({ where: { id: check.id }, data: { supportLevel: combinedSupport(check.supportLevel, help) } });
    }
  }
  await tx.learningRouteEvent.create({ data: { routeId: route.id, version: route.version, requestId: eventKey,
    sourceMessageId: source.id, changes: update as unknown as Prisma.InputJsonValue } });
  return learningRouteView(tx, input.revisionId);
}

export async function actOnLearningRoute(userId: string, conversationId: string, subjectId: string, action: LearningRouteAction) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    const owned = await tx.conversation.findFirst({ where: { id: conversationId, userId } });
    if (!owned) throw notFound('会话');
    if (owned.activeSubjectId !== subjectId) throw revisionConflict('学习对象已切换');
    const subject = await resolveSubject(tx, conversationId, subjectId), revision = await latestRevision(tx, subject.id);
    if (!revision?.confirmedAt) throw invalidFormat('请先确认学习范围');
    const route = await tx.learningRoute.findFirst({ where: { id: action.routeId, subjectRevisionId: revision.id }, include });
    if (!route) throw notFound('学习路线');
    const requestId = `client:${userId}:${action.requestId}`;
    const prior = await tx.learningRouteEvent.findUnique({ where: { requestId } });
    if (prior) {
      if (prior.routeId !== route.id || !isDeepStrictEqual(prior.changes, JSON.parse(JSON.stringify(action)))) throw revisionConflict('操作标识已被其他请求使用');
      return learningRouteView(tx, revision.id);
    }
    await assertIdle(tx, conversationId);
    if (route.version !== action.expectedVersion || route.status === 'ended') throw revisionConflict('学习进度已更新，请刷新后操作');
    if (action.action === 'revisit') {
      if (route.status !== 'active') throw invalidFormat('请先恢复学习');
      const node = route.nodes.find((n) => n.id === action.nodeId);
      if (!node || !['checked', 'skipped'].includes(node.status)) throw invalidFormat('请选择已跳过或已通过的节点');
      await revisitNode(tx, route, node.id);
    } else if (action.action === 'skip') {
      if (route.status !== 'active') throw invalidFormat('请先恢复学习');
      const node = route.nodes.find((n) => n.id === action.nodeId);
      if (!node || !['learning', 'needs_review', 'pending'].includes(node.status)) throw invalidFormat('请选择未通过的学习节点');
      await tx.learningRouteNode.update({ where: { id: node.id }, data: { status: 'skipped', version: { increment: 1 } } });
      if (route.currentNodeId === node.id) await focusNode(tx, route, nextNode(route, node.id));
    }
    await tx.learningRoute.update({ where: { id: route.id }, data: { version: { increment: 1 },
      ...(['pause', 'resume'].includes(action.action) ? { status: action.action === 'pause' ? 'paused' : 'active' } : {}) } });
    await tx.learningRouteEvent.create({ data: { routeId: route.id, version: route.version + 1, requestId,
      changes: action as unknown as Prisma.InputJsonValue } });
    return learningRouteView(tx, revision.id);
  });
}
