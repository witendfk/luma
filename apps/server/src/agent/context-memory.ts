import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { extractJson, summarizeContext, type ModelMessage, type ToolSet, type TokenUsage } from '../lib/model';
import { compactHistory, CompactionError, summaryMessage, summaryScope, SummaryBody, type SummaryCheckpoint } from './compaction';
import { historyPages } from './history';
import { fixedContextTokens } from './context';
import type { TurnPolicy } from './policy';
import { loadPrompt, PROMPT_VERSION } from './prompts';
import { modelBudgetAvailable, recordModelRequest, recordUsage, type RunCounters } from './limits';
import { RunStoppedError, withActiveRun } from './run-guard';

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
  const previous: SummaryCheckpoint | null = stored && body?.success ? { ...stored, body: body.data } : null;
  const result = await compactHistory({
    pages: historyPages(db, { conversationId: input.conversationId, subjectId: input.policy.subjectId,
      subjectRevisionId: input.policy.subjectRevisionId, focus: input.policy.focus, allowSolution: input.policy.allowSolution,
      before: boundary, ...(previous ? { after: { id: previous.throughMessageId, createdAt: previous.throughCreatedAt } } : {}) }),
    previous, fixedTokens: fixedContextTokens(input), inputLimit: env().CONTEXT_INPUT_TOKENS,
    outputReserve: env().MODEL_OUTPUT_TOKENS, ratio: env().CONTEXT_COMPACT_RATIO, summaryTokens: env().CONTEXT_SUMMARY_TOKENS,
    summarize: async (prior, rows, maxOutputTokens) => {
      input.signal.throwIfAborted();
      if (!modelBudgetAvailable(input.counters)) throw new CompactionError('摘要调用已达本轮预算，原对话已保留');
      recordModelRequest(input.counters, 'context_summary');
      await withActiveRun(input.runId, input.owner, (tx) => tx.agentRun.update({ where: { id: input.runId }, data: { counters: input.counters as unknown as Prisma.InputJsonValue } }));
      const started = Date.now(); let usage: TokenUsage | undefined, error: string | undefined;
      try {
        if (env().LUMA_MOCK_AGENT) return { notes: [{ kind: 'progress', text: '（模型mock）已有讨论的来源已记录。', refs: [rows[0]!.id] }] };
        const generated = await summarizeContext({ system: await loadPrompt('compact'),
          prompt: JSON.stringify({ previous: prior, messages: rows.map(({ id, role, content }) => ({ id, role, text: content })) }), maxOutputTokens,
          cacheKey: prefixCacheKey(input.userId, input.conversationId),
          abortSignal: AbortSignal.any([input.signal, AbortSignal.timeout(env().MODEL_REQUEST_MS)]) });
        usage = generated.usage;
        return extractJson(generated.raw);
      } catch { error = 'CONTEXT_SUMMARY_FAILED'; throw new CompactionError('长对话摘要生成失败，原文和已有摘要均已保留，可重试'); }
      finally {
        recordUsage(input.counters, usage);
        input.counters.calls.push({ purpose: 'context_summary', model: env().LUMA_MOCK_AGENT ? 'mock' : env().LUMA_MODEL_ID,
          attempt: input.counters.modelRequests.context_summary!, durationMs: Date.now() - started,
          inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, cachedInputTokens: usage?.cachedInputTokens ?? null, ...(error ? { error } : {}) });
        await withActiveRun(input.runId, input.owner, (tx) => tx.agentRun.update({ where: { id: input.runId }, data: { counters: input.counters as unknown as Prisma.InputJsonValue } }));
      }
    },
    save: async (checkpoint, expectedVersion) => {
      await withActiveRun(input.runId, input.owner, async (tx) => {
        const data = { ...key, ...checkpoint, body: checkpoint.body as unknown as Prisma.InputJsonValue };
        if (!expectedVersion) await tx.contextSummary.create({ data });
        else {
          const saved = await tx.contextSummary.updateMany({ where: { ...key, version: expectedVersion }, data });
          if (saved.count !== 1) throw new RunStoppedError('摘要版本冲突，未覆盖已有摘要');
        }
      });
    },
  });
  return { history: [...(result.checkpoint ? [summaryMessage(result.checkpoint)] : []), ...result.rows.map(({ role, content }) => ({ role, content }))] as ModelMessage[],
    compressedMessages: result.checkpoint?.coveredMessages ?? 0, summaryVersion: result.checkpoint?.version ?? 0 };
}
