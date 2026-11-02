import { db } from '../lib/db';
import { notFound } from '../lib/errors';
import { conversationService } from './conversation.service';

/**
 * 错题收藏（FR-09）：(用户, 会话) 唯一；重复保存恢复或更新原记录；
 * 取消收藏仅删除收藏本身，原对话与练习记录保留。
 */
export const collectionService = {
  async list(
    userId: string,
    query: { keyword?: string; reviewStatus?: 'to_review' | 'reviewed'; cursor?: string; limit: number },
  ) {
    const where: Record<string, unknown> = { userId };
    if (query.reviewStatus) where.reviewStatus = query.reviewStatus;
    if (query.cursor) where.collectedAt = { lt: new Date(query.cursor) };
    if (query.keyword?.trim()) {
      const kw = query.keyword.trim();
      where.conversation = {
        is: {
          userId,
          OR: [
            { title: { contains: kw, mode: 'insensitive' } },
            // 知识点标签参与搜索（FR-09）
            { subjectRevisions: { some: { tags: { has: kw } } } },
          ],
        },
      };
    }

    const rows = await db.collectionEntry.findMany({
      where,
      orderBy: [{ collectedAt: 'desc' }],
      take: query.limit + 1,
      include: {
        conversation: {
          select: { id: true, title: true, subjectRevisions: { orderBy: { version: 'desc' }, take: 1, select: { tags: true } } },
        },
      },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((entry) => ({
        id: entry.id,
        conversationId: entry.conversationId,
        title: entry.conversation.title,
        tags: entry.conversation.subjectRevisions[0]?.tags ?? [],
        note: entry.note,
        reviewStatus: entry.reviewStatus,
        collectedAt: entry.collectedAt,
      })),
      nextCursor:
        hasMore && page.length > 0
          ? (page[page.length - 1] as { collectedAt: Date }).collectedAt.toISOString()
          : null,
    };
  },

  async upsert(
    userId: string,
    conversationId: string,
    input: { note?: string; reviewStatus?: 'to_review' | 'reviewed' },
  ) {
    await conversationService.getOwned(userId, conversationId);
    const entry = await db.collectionEntry.upsert({
      where: { userId_conversationId: { userId, conversationId } },
      update: {
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.reviewStatus !== undefined ? { reviewStatus: input.reviewStatus } : {}),
      },
      create: {
        userId,
        conversationId,
        note: input.note ?? null,
        reviewStatus: input.reviewStatus ?? 'to_review',
      },
    });
    return entry;
  },

  async remove(userId: string, conversationId: string) {
    const result = await db.collectionEntry.deleteMany({
      where: { userId, conversationId },
    });
    if (result.count === 0) throw notFound('收藏');
    return { removed: true };
  },
};
