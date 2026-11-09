import type { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { estimateTokens } from '../lib/token-budget';
import type { TurnPolicy } from './policy';
import { historyMatches } from './history';
import { summaryScope } from './compaction';

interface ReadContext { userId: string; conversationId: string; policy: TurnPolicy; runId?: string }
interface SavedRead {
  id: string; status: string; tool: string; paramsDigest: unknown; resultRef: unknown;
  run: { id: string; subjectRevisionId: string | null; policySnapshot: unknown };
}

/** Only historical, completed, pure reads. Attempts can mark solutions viewed and are excluded. */
export function recoverableRead(row: SavedRead, policy: TurnPolicy) {
  const params = (row.paramsDigest as { input?: { ref?: string } } | null)?.input;
  const result = row.resultRef as { ok?: boolean } | null;
  const source = row.run.policySnapshot as TurnPolicy | null;
  return row.status === 'succeeded' && row.tool === 'readLearningContext' && result?.ok === true &&
    ['subject', 'artifacts', 'messages'].includes(params?.ref ?? '') &&
    row.run.subjectRevisionId === policy.subjectRevisionId && source?.subjectId === policy.subjectId &&
    source.subjectRevisionId === policy.subjectRevisionId && (!source.allowSolution || policy.allowSolution) &&
    (!source.answerPermission || policy.answerPermission) &&
    summaryScope(policy.subjectRevisionId ?? '', source.focus, false) === summaryScope(policy.subjectRevisionId ?? '', policy.focus, false);
}

/** JSON chunks are explicitly incomplete until final offset; never disguised as a complete object. */
export function boundedToolResult(value: unknown, offset = 0, budget = 6000) {
  const original = JSON.stringify(value);
  if (!Number.isInteger(offset) || offset < 0 || offset >= original.length) return { ok: false, code: 'INVALID_INPUT', message: '结果读取偏移无效' };
  const text = original.slice(offset);
  let end = text.length;
  if (estimateTokens(text) > budget) {
    let low = 0, high = end;
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (estimateTokens(text.slice(0, mid)) <= budget) low = mid; else high = mid - 1; }
    end = low;
    if (end && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
  }
  return { ok: true, encoding: 'json-chunk', text: text.slice(0, end), offset, complete: end === text.length,
    nextOffset: end < text.length ? offset + end : null };
}

/** Revalidate the saved snapshot's sources; no invocation of the original tool, especially no writes. */
async function sourceStillReadable(tx: Prisma.TransactionClient, ctx: ReadContext, row: SavedRead) {
  const result = row.resultRef as { subject?: { id: string }; artifactId?: string; version?: number;
    artifacts?: Array<{ id: string; version: number }>; messages?: Array<{ id: string }>; hits?: Array<{ id: string }>; pendingMessageIds?: string[]; nextRead?: { messageId: string } };
  const ref = (row.paramsDigest as { input: { ref: string } }).input.ref;
  if (ref === 'subject') return result.subject?.id === ctx.policy.subjectRevisionId;
  if (ref === 'artifacts') {
    const refs = result.artifactId ? [{ id: result.artifactId, version: result.version }] : result.artifacts ?? [];
    for (const source of refs) {
      const current = await tx.artifact.findFirst({ where: { id: source.id, version: source.version,
        conversationId: ctx.conversationId, subjectRevisionId: ctx.policy.subjectRevisionId ?? '', publishStatus: 'published' },
        select: { id: true, jobId: true } });
      const job = current?.jobId ? await tx.generationJob.findUnique({ where: { id: current.jobId }, select: { payload: true } }) : null;
      if (!current || ((job?.payload as { answerPermission?: boolean } | null)?.answerPermission && !ctx.policy.allowSolution)) return false;
    }
    return true;
  }
  const ids = [...new Set([...(result.messages ?? []).map((m) => m.id), ...(result.hits ?? []).map((m) => m.id),
    ...(result.pendingMessageIds ?? []), ...(result.nextRead ? [result.nextRead.messageId] : [])])];
  const sources = await tx.message.findMany({ where: { id: { in: ids }, conversationId: ctx.conversationId,
    subjectId: ctx.policy.subjectId, subjectRevisionId: ctx.policy.subjectRevisionId, status: 'complete', role: { in: ['user', 'assistant'] } }, select: { id: true, content: true } });
  return sources.length === ids.length && sources.every((m) => historyMatches(m.content, ctx.policy.focus, ctx.policy.allowSolution));
}

async function historicalRuns(ctx: ReadContext, tx: Prisma.TransactionClient) {
  const boundary = ctx.runId ? await tx.agentRun.findFirst({ where: { id: ctx.runId, conversationId: ctx.conversationId,
    conversation: { userId: ctx.userId } }, select: { userMessage: { select: { id: true, createdAt: true } } } }) : null;
  if (ctx.runId && !boundary?.userMessage) return null;
  return { conversationId: ctx.conversationId, subjectId: ctx.policy.subjectId, subjectRevisionId: ctx.policy.subjectRevisionId,
    status: { in: ['completed', 'waiting_user'] }, conversation: { userId: ctx.userId },
    ...(boundary?.userMessage ? { userMessage: { OR: [{ createdAt: { lt: boundary.userMessage.createdAt } },
      { createdAt: boundary.userMessage.createdAt, id: { lt: boundary.userMessage.id } }] } } : {}) };
}

/** Directory contains references only; raw data remains in ToolExecution/run.protocol. */
export async function historicalReadResults(ctx: ReadContext, tx: Prisma.TransactionClient = db) {
  const run = await historicalRuns(ctx, tx);
  if (!run) return { refs: [], recentDirectoryOnly: true };
  const rows = await tx.toolExecution.findMany({ where: {
    tool: 'readLearningContext', status: 'succeeded', ...(ctx.runId ? { runId: { not: ctx.runId } } : {}),
    run,
  }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30, include: { run: { select: { id: true, subjectRevisionId: true, policySnapshot: true } } } });
  const refs = [];
  for (const row of rows) {
    if (!recoverableRead(row, ctx.policy) || !await sourceStillReadable(tx, ctx, row)) continue;
    refs.push({ executionId: row.id, ref: (row.paramsDigest as { input: { ref: string } }).input.ref, createdAt: row.createdAt });
    if (refs.length === 5) break;
  }
  return { refs, recentDirectoryOnly: true, readWith: 'readLearningContext(ref=tool_result,executionId); JSON分块续读至complete。来源消息仍按messages回读，片段不算完整证据。' };
}

export async function readHistoricalToolResult(ctx: ReadContext, executionId: string, offset = 0, tx: Prisma.TransactionClient = db) {
  const run = await historicalRuns(ctx, tx);
  if (!run) return { ok: false, code: 'NOT_FOUND', message: '当前执行边界不存在' };
  const row = await tx.toolExecution.findFirst({ where: { id: executionId,
    ...(ctx.runId ? { runId: { not: ctx.runId } } : {}),
    run,
  }, include: { run: { select: { id: true, subjectRevisionId: true, policySnapshot: true } } } });
  if (!row || !recoverableRead(row, ctx.policy)) return { ok: false, code: 'NOT_FOUND', message: '结果引用不在当前可读范围' };
  if (!await sourceStillReadable(tx, ctx, row)) return { ok: false, code: 'STALE_REFERENCE', message: '原材料或消息已变更，请重新读取当前来源' };
  return { executionId: row.id, ...boundedToolResult(row.resultRef, offset) };
}
