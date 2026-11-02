import { db } from '../lib/db';
import { invalidFormat, notFound } from '../lib/errors';

/** 会话与消息（FR-02 / FR-10 / 设计文档 §10）：真实实现 */

export interface ListConversationsOptions {
  archived: boolean;
  cursor?: string;
  limit: number;
}

const listSelect = {
  id: true,
  title: true,
  archivedAt: true,
  lastActiveAt: true,
} as const;

async function touch(conversationId: string): Promise<void> {
  await db.conversation.update({ where: { id: conversationId }, data: { lastActiveAt: new Date() } });
}

export const conversationService = {
  /** 归属校验：所有会话级操作的入口（设计文档 §11） */
  async getOwned(userId: string, conversationId: string) {
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) throw notFound('会话');
    return conversation;
  },

  /** FR-10：最近学习 / 归档列表，按 lastActiveAt 倒序游标分页 */
  async list(userId: string, opts: ListConversationsOptions) {
    const where: Record<string, unknown> = {
      userId,
      archivedAt: opts.archived ? { not: null } : null,
    };
    if (opts.cursor) where.lastActiveAt = { lt: new Date(opts.cursor) };

    const rows = await db.conversation.findMany({
      where,
      orderBy: [{ lastActiveAt: 'desc' }],
      take: opts.limit + 1,
      select: listSelect,
    });
    const hasMore = rows.length > opts.limit;
    const items = hasMore ? rows.slice(0, opts.limit) : rows;
    return {
      items,
      nextCursor:
        hasMore && items.length > 0
          ? (items[items.length - 1] as { lastActiveAt: Date }).lastActiveAt.toISOString()
          : null,
    };
  },

  /** FR-02：创建会话，围绕一题或一个知识点；首条文字生成学习对象 v1（待确认） */
  async create(userId: string, input: { title?: string; subjectType?: 'question' | 'knowledge'; initialText?: string }) {
    const subjectType = input.subjectType === 'knowledge' ? 'knowledge' : 'question';
    const title =
      input.title?.trim() ||
      (input.initialText ? input.initialText.trim().slice(0, 24) : '新对话');

    const conversation = await db.conversation.create({
      data: {
        userId,
        title,
        subjectRevisions: input.initialText
          ? {
              create: {
                version: 1,
                type: subjectType,
                content: { text: input.initialText },
                tags: [],
              },
            }
          : undefined,
        progress: {
          create: { stage: 'clarifying' },
        },
      },
      include: { subjectRevisions: { orderBy: { version: 'desc' }, take: 1 }, progress: true },
    });

    if (conversation.subjectRevisions[0]) {
      await db.learningProgress.update({
        where: { conversationId: conversation.id },
        data: { subjectRevisionId: conversation.subjectRevisions[0].id },
      });
    }
    return {
      id: conversation.id,
      title: conversation.title,
      archivedAt: conversation.archivedAt,
      lastActiveAt: conversation.lastActiveAt,
    };
  },

  /** GET /conversations/:id —— 当前题目、进度和材料概览（设计文档 §10） */
  async get(userId: string, conversationId: string) {
    const conversation = await this.getOwned(userId, conversationId);
    const [progress, subject, artifacts, activeRun] = await Promise.all([
      db.learningProgress.findUnique({ where: { conversationId } }),
      db.subjectRevision.findFirst({ where: { conversationId }, orderBy: { version: 'desc' } }),
      db.artifact.findMany({
        where: { conversationId },
        orderBy: [{ updatedAt: 'desc' }],
        select: {
          id: true,
          type: true,
          version: true,
          publishStatus: true,
          subjectRevisionId: true,
          jobId: true,
        },
      }),
      db.agentRun.findFirst({
        where: { conversationId, status: { in: ['running', 'waiting_job'] } },
        orderBy: { startedAt: 'desc' }, select: { id: true, status: true },
      }),
    ]);
    return { conversation, progress, subject, artifacts, activeRun };
  },

  /** FR-10：重命名、归档、恢复；恢复/重命名都算学习活动，刷新排序 */
  async update(userId: string, conversationId: string, input: { title?: string; archived?: boolean }) {
    const conversation = await this.getOwned(userId, conversationId);
    const data: { title?: string; archivedAt?: Date | null; lastActiveAt: Date } = {
      lastActiveAt: new Date(),
    };
    if (input.title !== undefined) {
      const t = input.title.trim();
      if (!t) throw invalidFormat('标题不能为空');
      data.title = t;
    }
    if (input.archived === true) data.archivedAt = new Date();
    if (input.archived === false) data.archivedAt = null;

    return db.conversation.update({ where: { id: conversation.id }, data, select: listSelect });
  },

  /** FR-10：消息分页（游标往前翻），按时间正序返回 */
  async messages(userId: string, conversationId: string, opts: { cursor?: string; limit: number }) {
    await this.getOwned(userId, conversationId);
    const where: Record<string, unknown> = { conversationId };
    if (opts.cursor) where.id = { lt: opts.cursor };

    const rows = await db.message.findMany({
      where,
      orderBy: [{ id: 'desc' }],
      take: opts.limit + 1,
    });
    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    return {
      items: page.reverse(),
      nextCursor: hasMore && page.length > 0 ? (page[0] as { id: string }).id : null,
    };
  },

  touch,
};
