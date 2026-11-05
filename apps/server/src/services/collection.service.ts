import { db } from '../lib/db';
import { invalidFormat, notFound } from '../lib/errors';

/** Collections belong to an object, never to the active object of a conversation. */
async function owned(userId: string, subjectId: string) {
  const subject = await db.learningSubject.findFirst({ where: { id: subjectId, conversation: { userId } }, include: { revisions: { orderBy: { version: 'desc' }, take: 1 } } });
  if (!subject) throw notFound('学习对象');
  return subject;
}
export const collectionService = {
  async list(userId: string, query: { keyword?: string; reviewStatus?: 'to_review' | 'reviewed'; cursor?: string; limit: number; view?: 'all' | 'question' | 'knowledge' }) {
    const kw = query.keyword?.trim();
    const rows = await db.collectionEntry.findMany({
      where: { userId, removedAt: null,
        ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
        ...(query.cursor ? { collectedAt: { lt: new Date(query.cursor) } } : {}),
        subject: { revisions: { some: { ...(query.view && query.view !== 'all' ? { type: query.view } : {}),
          ...(kw ? { OR: [{ tags: { has: kw } }, { content: { path: ['text'], string_contains: kw } }] } : {}),
        } } },
      },
      orderBy: [{ collectedAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
      include: { subject: { include: { revisions: { orderBy: { version: 'desc' }, take: 1 } } } },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return { items: page.map(({ subject, ...entry }) => ({ ...entry,
      title: (subject.revisions[0]?.content as { text?: string })?.text ?? '学习记录',
      tags: subject.revisions[0]?.tags ?? [], type: subject.revisions[0]?.type,
    })), nextCursor: hasMore ? page[page.length - 1]!.collectedAt.toISOString() : null };
  },
  async get(userId: string, subjectId: string) {
    await owned(userId, subjectId);
    return db.collectionEntry.findUnique({ where: { userId_subjectId: { userId, subjectId } } });
  },
  async upsert(userId: string, subjectId: string, input: { note?: string; reviewStatus?: 'to_review' | 'reviewed' }) {
    const subject = await owned(userId, subjectId);
    if (!subject.revisions[0]?.confirmedAt) throw invalidFormat('请先核对学习内容');
    return db.collectionEntry.upsert({
      where: { userId_subjectId: { userId, subjectId } },
      update: { removedAt: null, ...(input.note !== undefined ? { note: input.note } : {}), ...(input.reviewStatus ? { reviewStatus: input.reviewStatus } : {}) },
      create: { userId, subjectId, conversationId: subject.conversationId, note: input.note ?? null, reviewStatus: input.reviewStatus ?? 'to_review' },
    });
  },
  async remove(userId: string, subjectId: string) {
    await owned(userId, subjectId);
    const result = await db.collectionEntry.updateMany({ where: { userId, subjectId }, data: { removedAt: new Date() } });
    if (!result.count) throw notFound('收藏');
    return { removed: true };
  },
};
