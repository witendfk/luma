import { db } from '../lib/db';
import { invalidFormat, revisionConflict } from '../lib/errors';
import type { ProgressRequest } from '@luma/shared';
import { assertIdle, resolveSubject, requireRevision } from './subject-context';
import { validateFocus } from './focus';
import { conversationService } from './conversation.service';
import { recordRouteReading } from './learning-route';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';

/**
 * 学习对象版本与过程转写（FR-03 / 设计文档 §3.1）。
 * 更新生成新版本并标记旧任务 superseded；确认后进入引导阶段。
 */
export const subjectService = {
  async create(userId: string, conversationId: string, input: { type: 'question' | 'knowledge'; content: object }) {
    await conversationService.getOwned(userId, conversationId);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      await assertIdle(tx, conversationId);
      const last = await tx.learningSubject.findFirst({ where: { conversationId }, orderBy: { order: 'desc' } });
      const subject = await tx.learningSubject.create({ data: { conversationId, order: (last?.order ?? -1) + 1 } });
      const revision = await tx.subjectRevision.create({ data: { conversationId, subjectId: subject.id, version: 1, type: input.type, content: input.content } });
      const progress = await tx.learningProgress.create({ data: { conversationId, subjectId: subject.id, subjectRevisionId: revision.id } });
      return { subject: revision, progress };
    });
  },

  async focus(userId: string, conversationId: string, input: { subjectId: string; learnAll?: boolean }) {
    await conversationService.getOwned(userId, conversationId);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      const subject = await resolveSubject(tx, conversationId, input.subjectId);
      await assertIdle(tx, conversationId);
      await tx.conversation.update({ where: { id: conversationId }, data: { activeSubjectId: subject.id, ...(input.learnAll !== undefined ? { learnAll: input.learnAll } : {}) } });
    });
    return conversationService.get(userId, conversationId);
  },

  async progress(userId: string, conversationId: string, subjectId: string, input: ProgressRequest) {
    await conversationService.getOwned(userId, conversationId);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      await resolveSubject(tx, conversationId, subjectId);
      const revision = await requireRevision(tx, subjectId, input.expectedRevision);
      await validateFocus(tx, userId, conversationId, revision.id, input);
      if (input.destination === 'reader' && (!input.artifactId || !input.sectionId)) throw invalidFormat('缺少阅读位置');
      if (input.destination === 'practice' && (!input.artifactId || !input.attemptId)) throw invalidFormat('缺少练习位置');
      if (input.destination !== 'chat') {
        const artifact = await tx.artifact.findUniqueOrThrow({ where: { id: input.artifactId } });
        if (artifact.type !== (input.destination === 'reader' ? 'lesson' : 'exercise_set')) throw invalidFormat('材料类型与页面不符');
      }
      const result = await tx.learningProgress.updateMany({
        where: { subjectId, version: input.expectedVersion },
        data: { destination: input.destination, subjectRevisionId: revision.id, version: { increment: 1 },
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
          currentArtifactId: input.artifactId ?? null, currentSectionId: input.sectionId ?? null,
          currentAttemptId: input.attemptId ?? null, currentExerciseId: input.exerciseId ?? null },
      });
      if (result.count !== 1) throw revisionConflict('学习位置已更新，请刷新后重试');
      if (input.destination === 'reader') await recordRouteReading(tx, revision.id, `${subjectId}:${input.expectedVersion + 1}`);
      return tx.learningProgress.findUniqueOrThrow({ where: { subjectId } });
    });
  },
  async update(
    userId: string,
    conversationId: string,
    input: {
      action: 'update' | 'confirm';
      subjectId?: string;
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
      const object = await resolveSubject(tx, conversationId, input.subjectId);
      const latest = await requireRevision(tx, object.id, input.expectedRevision);


      if (input.action === 'confirm') {
        if (latest.confirmedAt) return { subject: latest, progress: await tx.learningProgress.findUnique({ where: { subjectId: object.id } }) };
        const subject = await tx.subjectRevision.update({
          where: { id: latest.id },
          data: { confirmedAt: new Date() },
        });
        const progress = await tx.learningProgress.upsert({
          where: { subjectId: object.id },
          update: { stage: 'guiding', subjectRevisionId: latest.id, version: { increment: 1 } },
          create: { conversationId, subjectId: object.id, subjectRevisionId: latest.id, stage: 'guiding' },
        });
        await tx.conversation.update({ where: { id: conversationId }, data: { lastActiveAt: new Date() } });
        return { subject, progress };
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
          subjectId: object.id,
          version: latest.version + 1,
          type: latest.type,
          content: { ...(latest.content as object), ...((input.content ?? {}) as object) },
          tags: input.tags ?? latest.tags,
          subquestions,
          activeSubquestionIndex: subquestions.length ? selected ?? 0 : null,
          // 新版本必须重新确认（FR-03：确认前不按未核实条件生成解答）
          confirmedAt: null,
          originAttachmentId: latest.originAttachmentId,
        },
      });
      await tx.agentRun.updateMany({ where: { conversationId, subjectId: object.id, status: { in: ['running', 'waiting_job'] } }, data: { status: 'cancelled', finishedAt: new Date() } });
      // 来源已改变：旧版本未完成的任务不再成为当前成果（设计文档 §8.3 superseded）
      await tx.generationJob.updateMany({
        where: { subjectRevisionId: latest.id, status: { in: ['queued', 'running'] } },
        data: { status: 'superseded' },
      });
      const progress = await tx.learningProgress.upsert({
        where: { subjectId: object.id },
        update: { version: { increment: 1 }, currentArtifactId: null, currentSectionId: null, currentAttemptId: null, currentExerciseId: null, destination: 'chat', subjectRevisionId: revision.id, stage: 'clarifying' },
        create: { conversationId, subjectId: object.id, subjectRevisionId: revision.id, stage: 'clarifying' },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { lastActiveAt: new Date() } });
      return { subject: revision, progress };
    });
  },

  async confirmTranscript(
    userId: string,
    conversationId: string,
    transcriptId: string,
    input: { confirmedSteps?: unknown },
  ) {
    await conversationService.getOwned(userId, conversationId);
    const steps = z.array(z.string().trim().min(1).max(2000)).min(1).max(30).parse(input.confirmedSteps);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      const transcript = await tx.processTranscript.findFirst({ where: { id: transcriptId, conversationId } });
      if (!transcript) throw invalidFormat('过程转写不存在');
      const revision = await tx.subjectRevision.findUniqueOrThrow({ where: { id: transcript.subjectRevisionId } });
      const latest = await requireRevision(tx, revision.subjectId);
      if (latest.id !== revision.id || !latest.confirmedAt) throw revisionConflict('题目已修改，请重新上传并核对过程');
      await assertIdle(tx, conversationId);
      if (transcript.status === 'confirmed') {
        if (!isDeepStrictEqual(transcript.confirmedSteps, steps)) throw revisionConflict('已确认的步骤不能覆盖，请重新上传过程');
        return { transcript };
      }
      return { transcript: await tx.processTranscript.update({ where: { id: transcript.id },
        data: { confirmedSteps: steps as Prisma.InputJsonValue, status: 'confirmed' } }) };
    });
  },
};
