import { db } from '../lib/db';
import { invalidFormat, revisionConflict } from '../lib/errors';
import { conversationService } from './conversation.service';

/**
 * 学习对象版本与过程转写（FR-03 / 设计文档 §3.1）。
 * 更新生成新版本并标记旧任务 superseded；确认后进入引导阶段。
 */
export const subjectService = {
  async update(
    userId: string,
    conversationId: string,
    input: {
      action: 'update' | 'confirm';
      content?: unknown;
      tags?: string[];
      subquestions?: string[];
      subquestionIndex?: number;
      expectedRevision?: number;
    },
  ) {
    await conversationService.getOwned(userId, conversationId);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      const latest = await tx.subjectRevision.findFirst({
        where: { conversationId },
        orderBy: { version: 'desc' },
      });
      if (input.expectedRevision !== undefined && latest && latest.version !== input.expectedRevision) {
        throw revisionConflict();
      }

      if (input.action === 'confirm') {
        if (!latest) throw invalidFormat('没有可确认的学习对象');
        const subject = await tx.subjectRevision.update({
          where: { id: latest.id },
          data: { confirmedAt: new Date() },
        });
        await tx.learningProgress.upsert({
          where: { conversationId },
          update: { stage: 'guiding', subjectRevisionId: latest.id },
          create: { conversationId, subjectRevisionId: latest.id, stage: 'guiding' },
        });
        await tx.conversation.update({ where: { id: conversationId }, data: { lastActiveAt: new Date() } });
        return { subject };
      }

      if (!latest) throw invalidFormat('会话尚无学习对象，请先发送题目或知识点');
      const subquestions = input.subquestions ?? (Array.isArray(latest.subquestions) ? latest.subquestions : []);
      const selected = input.subquestionIndex ?? (input.subquestions ? (subquestions.length ? 0 : null) : latest.activeSubquestionIndex);
      if (selected !== null && selected !== undefined && (!Number.isInteger(selected) || selected < 0 || selected >= subquestions.length)) {
        throw invalidFormat('请选择有效的小问');
      }
      const revision = await tx.subjectRevision.create({
        data: {
          conversationId,
          version: latest.version + 1,
          type: latest.type,
          content: { ...(latest.content as object), ...((input.content ?? {}) as object) },
          tags: input.tags ?? latest.tags,
          subquestions,
          activeSubquestionIndex: subquestions.length ? selected ?? 0 : null,
          // 新版本必须重新确认（FR-03：确认前不按未核实条件生成解答）
          confirmedAt: null,
        },
      });
      await tx.agentRun.updateMany({ where: { conversationId, status: { in: ['running', 'waiting_job'] } }, data: { status: 'cancelled', finishedAt: new Date() } });
      // 来源已改变：旧版本未完成的任务不再成为当前成果（设计文档 §8.3 superseded）
      await tx.generationJob.updateMany({
        where: { subjectRevisionId: latest.id, status: { in: ['queued', 'running'] } },
        data: { status: 'superseded' },
      });
      await tx.learningProgress.upsert({
        where: { conversationId },
        update: { subjectRevisionId: revision.id, stage: 'clarifying' },
        create: { conversationId, subjectRevisionId: revision.id, stage: 'clarifying' },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { lastActiveAt: new Date() } });
      return { subject: revision };
    });
  },

  async confirmTranscript(
    userId: string,
    conversationId: string,
    transcriptId: string,
    _input: { confirmedSteps?: unknown },
  ) {
    await conversationService.getOwned(userId, conversationId);
    const transcript = await db.processTranscript.findFirst({
      where: { id: transcriptId, conversationId },
    });
    if (!transcript) {
      // 解题过程转写依赖上传链路（第二周接入）
      throw invalidFormat('过程转写功能尚未接入');
    }
    return { transcript };
  },
};
