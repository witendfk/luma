import type { Prisma } from '@prisma/client';
import { textOf } from './blocks';
import type { TaskFrame } from './types';
import type { HistoryRow } from './compaction';

export function historyMatches(content: unknown, focus: TaskFrame['focus'], allowSolution: boolean): boolean {
  const data = content as { containsSolution?: boolean; focus?: TaskFrame['focus'] } | null;
  if (data?.containsSolution && !allowSolution) return false;
  return (['artifactId', 'artifactVersion', 'sectionId', 'attemptId', 'exerciseId'] as const)
    .every((key) => (data?.focus?.[key] ?? null) === (focus?.[key] ?? null));
}

/** Ascending raw history for rolling compression. No token-based truncation before summarization. */
export async function* historyPages(tx: Prisma.TransactionClient, input: {
  conversationId: string; subjectId: string; subjectRevisionId: string;
  focus: TaskFrame['focus']; allowSolution: boolean;
  before: { id: string; createdAt: Date }; after?: { id: string; createdAt: Date };
}): AsyncGenerator<HistoryRow[]> {
  let cursor: string | undefined;
  for (;;) {
    const page = await tx.message.findMany({ where: {
      conversationId: input.conversationId, subjectId: input.subjectId, subjectRevisionId: input.subjectRevisionId,
      status: 'complete', role: { in: ['user', 'assistant'] }, AND: [
        { OR: [{ createdAt: { lt: input.before.createdAt } }, { createdAt: input.before.createdAt, id: { lt: input.before.id } }] },
        ...(input.after ? [{ OR: [{ createdAt: { gt: input.after.createdAt } }, { createdAt: input.after.createdAt, id: { gt: input.after.id } }] }] : []),
      ],
    }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const rows = page.filter((m) => historyMatches(m.content, input.focus, input.allowSolution))
      .map((m) => ({ id: m.id, createdAt: m.createdAt, role: m.role as 'user' | 'assistant', content: textOf(m.content) })).filter((m) => m.content);
    if (rows.length) yield rows;
    if (page.length < 100) return;
    cursor = page.at(-1)!.id;
  }
}
