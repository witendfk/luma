import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { extractJson, summarizeContext, type ModelMessage, type ToolSet, type TokenUsage } from '../lib/model';
import { compactHistory, CompactionError, protectedHistoryStart, summaryMessage, summaryScope, SummaryBody, type RetiredSource, type SummaryCheckpoint } from './compaction';
import { historyPages } from './history';
import { fixedContextTokens } from './context';
import type { TurnPolicy } from './policy';
import { loadPrompt, PROMPT_VERSION } from './prompts';
import { settleModelRequest, type RunCounters } from './limits';
import { reserveRunModel } from '../lib/model-accounting';
import { estimateTokens } from '../lib/token-budget';
import { RunStoppedError, withActiveRun } from './run-guard';
import { memoryVisible } from './teaching-memory';

export function prefixCacheKey(userId: string, conversationId: string): string {
  return `luma:${PROMPT_VERSION}:${summaryScope(conversationId, { artifactId: userId }, false).slice(0, 32)}`;
}

/** Runs outside DB transactions; each completed summary checkpoint commits under the active-run guard. */
export async function prepareContextMemory(input: {
  runId: string; owner: string; userId: string; conversationId: string; userMessageId: string | null;
  policy: TurnPolicy; system: string; facts: ModelMessage; current: ModelMessage[]; tools: ToolSet;
  counters: RunCounters; signal: AbortSignal;
}) {
  if (!input.policy.subjectRevisionId || !input.userMessageId) return { history: [] as ModelMessage[], compressedMessages: 0, summaryVersion: 0 };
  const boundary = await db.message.findFirstOrThrow({ where: { id: input.userMessageId, conversationId: input.conversationId,
    subjectRevisionId: input.policy.subjectRevisionId, role: 'user' }, select: { id: true, createdAt: true } });
  const scopeKey = summaryScope(input.policy.subjectRevisionId, input.policy.focus, input.policy.allowSolution);
  const key = { subjectRevisionId: input.policy.subjectRevisionId, scopeKey };
  const stored = await db.contextSummary.findUnique({ where: { subjectRevisionId_scopeKey: key } });
  const body = stored ? SummaryBody.safeParse(stored.body) : null;
  // A summary covering a later question cannot be replayed into an earlier run.
  if (stored && (!body?.success || stored.throughCreatedAt > boundary.createdAt ||
    (stored.throughCreatedAt.getTime() === boundary.createdAt.getTime() && stored.throughMessageId >= boundary.id))) {
    throw new RunStoppedError('摘要来源已更新，请继续当前对话');
  }
  let previous: SummaryCheckpoint | null = stored && body?.success ? { ...stored, body: body.data } : null;
  const historyInput = { conversationId: input.conversationId, subjectId: input.policy.subjectId,
    subjectRevisionId: input.policy.subjectRevisionId, focus: input.policy.focus, allowSolution: input.policy.allowSolution,
    before: boundary };
  const protectedFrom = await protectedHistoryStart(historyPages(db, { ...historyInput, direction: 'desc' }));
  // Old-version checkpoints may have swallowed a recent round. Rebuild from raw history,
  // retaining the stored CAS version and immutable audits rather than replaying that summary.
  if (previous && (!protectedFrom || previous.throughCreatedAt > protectedFrom.createdAt ||
    (previous.throughCreatedAt.getTime() === protectedFrom.createdAt.getTime() && previous.throughMessageId >= protectedFrom.id))) previous = null;
  // Query lifecycle only for quoted sources actually present in this checkpoint.
  async function retiredSources(refs: string[]): Promise<RetiredSource[]> {
    if (!refs.length) return [];
    const inactive = await db.teachingMemory.findMany({ where: {
      subjectRevisionId: input.policy.subjectRevisionId!, status: { in: ['resolved', 'superseded'] },
      OR: refs.map((messageId) => ({ evidence: { array_contains: [{ messageId }] } })),
    } });
    return inactive.filter((m) => memoryVisible({ ...m, status: 'active' }, input.policy)).flatMap((m) => {
      const original = (m.evidence as Array<{ messageId: string; quote: string }>)[0];
      return original?.quote && refs.includes(original.messageId) ? [{ memoryId: m.id, ...original, status: m.status }] : [];
    });
  }
  const retired = await retiredSources([...new Set(previous?.body.notes.flatMap((n) => n.quote ? n.refs : []) ?? [])]);
  const result = await compactHistory({
    pages: historyPages(db, { ...historyInput, ...(previous ? { after: { id: previous.throughMessageId, createdAt: previous.throughCreatedAt } } : {}) }),
    protectedFrom, retired, initialVersion: stored?.version,
    previous, fixedTokens: fixedContextTokens(input), inputLimit: env().CONTEXT_INPUT_TOKENS,
    outputReserve: env().MODEL_OUTPUT_TOKENS, ratio: env().CONTEXT_COMPACT_RATIO, summaryTokens: env().CONTEXT_SUMMARY_TOKENS,
    summarize: async (prior, rows, maxOutputTokens) => {
      input.signal.throwIfAborted();
      for (const source of await retiredSources(rows.map((r) => r.id))) if (!retired.some((r) => r.memoryId === source.memoryId)) retired.push(source);
      const system = await loadPrompt('compact');
      const prompt = JSON.stringify({ previous: prior, retired, messages: rows.map(({ id, role, content }) => ({ id, role, text: content })) });
      const callId = await reserveRunModel({ ...input, purpose: 'context_summary', inputTokens: estimateTokens({ system, prompt }) + 512, outputTokens: maxOutputTokens });
      const started = Date.now(); let usage: TokenUsage | undefined, error: string | undefined;
      try {
        if (env().LUMA_MOCK_AGENT) return { notes: [{ kind: 'progress', text: '（模型mock）已有讨论的来源已记录。', refs: [rows[0]!.id] }],
          coverage: rows.filter((r) => r.role === 'user').map((r) => ({ messageId: r.id, disposition: 'process', refs: [r.id], reason: '隔离测试中的一般讨论' })) };
        const generated = await summarizeContext({ system, prompt, maxOutputTokens,
          cacheKey: prefixCacheKey(input.userId, input.conversationId),
          abortSignal: AbortSignal.any([input.signal, AbortSignal.timeout(env().MODEL_REQUEST_MS)]) });
        usage = generated.usage;
        return extractJson(generated.raw);
      } catch { error = 'CONTEXT_SUMMARY_FAILED'; throw new CompactionError('长对话摘要生成失败，原文和已有摘要均已保留，可重试'); }
      finally {
        settleModelRequest(input.counters, callId, usage);
        input.counters.calls.push({ purpose: 'context_summary', model: env().LUMA_MOCK_AGENT ? 'mock' : env().LUMA_MODEL_ID,
          attempt: input.counters.modelRequests.context_summary!, durationMs: Date.now() - started,
          inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, cachedInputTokens: usage?.cachedInputTokens ?? null, ...(error ? { error } : {}) });
        await withActiveRun(input.runId, input.owner, (tx) => tx.agentRun.update({ where: { id: input.runId }, data: { counters: input.counters as unknown as Prisma.InputJsonValue } }));
      }
    },
    save: async (checkpoint, expectedVersion, audit) => {
      await withActiveRun(input.runId, input.owner, async (tx) => {
        const data = { ...key, ...checkpoint, body: checkpoint.body as unknown as Prisma.InputJsonValue };
        if (!expectedVersion) await tx.contextSummary.create({ data });
        else {
          const saved = await tx.contextSummary.updateMany({ where: { ...key, version: expectedVersion }, data });
          if (saved.count !== 1) throw new RunStoppedError('摘要版本冲突，未覆盖已有摘要');
        }
        // Immutable per-version manifest: same guarded transaction as the checkpoint cursor.
        // Internal audit, not a model-callable tool and never replayed as an operation.
        const reference = `context:${scopeKey}:${checkpoint.version}`;
        await tx.toolExecution.create({ data: { runId: input.runId, decisionId: reference, toolCallId: reference,
          tool: 'contextSummaryCheckpoint', batchOrder: 0, status: 'succeeded',
          resultRef: { scopeKey, ...checkpoint, throughCreatedAt: checkpoint.throughCreatedAt.toISOString(), ...audit } as unknown as Prisma.InputJsonValue } });
      });
    },
  });
  return { history: [...(result.checkpoint ? [summaryMessage(result.checkpoint)] : []), ...result.rows.map(({ role, content }) => ({ role, content }))] as ModelMessage[],
    compressedMessages: result.checkpoint?.coveredMessages ?? 0, summaryVersion: result.checkpoint?.version ?? 0 };
}
