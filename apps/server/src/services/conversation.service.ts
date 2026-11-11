import { db } from '../lib/db';
import { ApiError, invalidFormat, notFound } from '../lib/errors';
import { resolveSubject } from './subject-context';
import { validateFocus } from './focus';
import { createConversationTitle, restoreLegacyTitle } from '../lib/conversation-title';
import { projectMaterialTasks } from './material-tasks';

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
      select: {
        ...listSelect,
        subjectRevisions: { where: { version: 1 }, take: 1, select: { content: true } },
      },
    });
    const hasMore = rows.length > opts.limit;
    const items = (hasMore ? rows.slice(0, opts.limit) : rows).map(({ subjectRevisions, ...item }) => ({
      ...item,
      title: restoreLegacyTitle(item.title, subjectRevisions[0]?.content),
    }));
    return {
      items,
      nextCursor:
        hasMore && items.length > 0
          ? (items[items.length - 1] as { lastActiveAt: Date }).lastActiveAt.toISOString()
          : null,
    };
  },

  /** FR-02：创建会话，围绕一题或一个知识点；首条文字生成学习对象 v1（待确认） */
  async create(userId: string, input: { title?: string; subjectType?: 'question' | 'knowledge'; intent?: 'question' | 'knowledge' | 'practice'; initialText?: string }) {
    const subjectType = input.subjectType === 'knowledge' ? 'knowledge' : 'question';
    const title =
      input.title?.trim() ||
      createConversationTitle(input.initialText ?? '');

    const conversation = await db.$transaction(async (tx) => {
      const row = await tx.conversation.create({ data: { userId, title } });
      const subject = await tx.learningSubject.create({ data: { conversationId: row.id, order: 0 } });
      const revision = input.initialText ? await tx.subjectRevision.create({ data: {
        conversationId: row.id, subjectId: subject.id, version: 1, type: subjectType,
        content: { text: input.initialText, intent: input.intent ?? subjectType }, tags: [],
      } }) : null;
      await tx.learningProgress.create({ data: { conversationId: row.id, subjectId: subject.id, subjectRevisionId: revision?.id } });
      return tx.conversation.update({ where: { id: row.id }, data: { activeSubjectId: subject.id } });
    });
    return {
      id: conversation.id,
      title: conversation.title,
      archivedAt: conversation.archivedAt,
      lastActiveAt: conversation.lastActiveAt,
    };
  },

  /** GET /conversations/:id —— 当前题目、进度和材料概览（设计文档 §10） */
  async get(userId: string, conversationId: string) {
    await this.getOwned(userId, conversationId);
    return db.$transaction(async (tx) => {
      const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      const objects = await tx.learningSubject.findMany({
        where: { conversationId }, orderBy: { order: 'asc' },
        include: { revisions: { orderBy: { version: 'desc' }, take: 1 }, progress: true, collections: { where: { userId, removedAt: null }, select: { id: true } } },
      });
      const subjects = await Promise.all(objects.map(async ({ revisions, collections, ...row }) => {
        const revision = revisions[0] ?? null;
        let progress = row.progress;
        if (progress) {
          let valid = progress.subjectRevisionId === (revision?.id ?? null);
          try {
            if (valid && revision) await validateFocus(tx, userId, conversationId, revision.id, {
              artifactId: progress.currentArtifactId ?? undefined, sectionId: progress.currentSectionId ?? undefined,
              attemptId: progress.currentAttemptId ?? undefined, exerciseId: progress.currentExerciseId ?? undefined,
            });
          } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            valid = false;
          }
          // Old/damaged navigation pointers fall back to chat. A GET never rewrites history.
          if (!valid) progress = { ...progress, subjectRevisionId: revision?.id ?? null,
            stage: revision?.confirmedAt ? 'guiding' : 'clarifying', destination: 'chat',
            currentArtifactId: null, currentSectionId: null, currentAttemptId: null, currentExerciseId: null };
        }
        return { id: row.id, order: row.order, revision, progress, collected: collections.length > 0 };
      }));
      const active = subjects.find((row) => row.id === conversation.activeSubjectId);
      const artifacts = active ? await tx.artifact.findMany({
        where: { conversationId, subjectRevision: { subjectId: active.id } }, orderBy: { updatedAt: 'desc' },
        select: { id: true, type: true, version: true, publishStatus: true, subjectRevisionId: true, jobId: true, content: true },
      }) : [];
      const activeRun = await tx.agentRun.findFirst({
        where: { conversationId, status: { in: ['running', 'waiting_job'] } }, orderBy: { startedAt: 'desc' }, select: { id: true, status: true },
      });
      const latestRun = active ? await tx.agentRun.findFirst({ where: { conversationId, subjectId: active.id, subjectRevisionId: active.revision?.id }, orderBy: { startedAt: 'desc' }, select: { id: true, status: true, error: true } }) : null;
      const lessonJob = active?.revision ? await tx.generationJob.findFirst({ where: { conversationId, subjectRevisionId: active.revision.id, type: 'lesson' }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, step: true } }) : null;
      const jobs = active ? await tx.generationJob.findMany({ where: { conversationId, subjectId: active.id, type: { in: ['lesson', 'exercise_set'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, type: true, runId: true, subjectRevisionId: true, status: true, step: true, resultArtifactId: true, retryOfJobId: true, payload: true, error: true } }) : [];
      const runs = active ? await tx.agentRun.findMany({ where: { conversationId, subjectId: active.id },
        select: { id: true, userMessageId: true, subjectRevisionId: true, taskFrame: true } }) : [];
      const materialTasks = projectMaterialTasks(jobs, artifacts, runs, active?.revision?.id);
      const learningRoute = await learningRouteView(tx, active?.revision?.id);
      return { conversation, subjects, subject: active?.revision ?? null, progress: active?.progress ?? null,
        learningRoute,
        artifacts: artifacts.map(({ content: _content, ...row }) => ({ ...row, subjectId: active!.id })), activeRun, latestRun, lessonJob, materialTasks };
    }, { isolationLevel: 'RepeatableRead' });
  },

  /** FR-10：重命名、归档、恢复；管理操作不改变最近学习时间 */
  async update(userId: string, conversationId: string, input: { title?: string; archived?: boolean }) {
    const conversation = await this.getOwned(userId, conversationId);
    const data: { title?: string; archivedAt?: Date | null } = {};
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
  async messages(userId: string, conversationId: string, opts: { cursor?: string; limit: number; subjectId?: string }) {
    await this.getOwned(userId, conversationId);
    const subject = await resolveSubject(db, conversationId, opts.subjectId);
    const where: Record<string, unknown> = { conversationId, subjectId: subject.id };
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
import { learningRouteView } from './learning-route';
