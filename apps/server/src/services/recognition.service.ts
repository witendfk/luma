import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { RecognitionRequest, type RecognitionView } from '@luma/shared';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { invalidFormat, notFound, revisionConflict } from '../lib/errors';
import { assertIdle } from './subject-context';

export interface RecognitionPayload extends RecognitionRequest { materialType: 'question' | 'process' | 'answer' }
export function recognitionView(job: { id: string; status: string; payload: unknown; error: unknown; draftCheckpoint: unknown }): RecognitionView {
  const payload = job.payload as RecognitionPayload;
  const result = job.draftCheckpoint as { transcriptId?: string; result?: { steps: string[]; uncertainties: string[] } } | null;
  return { id: job.id, status: job.status as RecognitionView['status'], materialType: payload.materialType,
    attachmentIds: payload.attachmentIds, text: payload.text, transcriptId: result?.transcriptId,
    steps: result?.result?.steps, uncertainties: result?.result?.uncertainties,
    error: job.error as RecognitionView['error'] };
}
export const recognitionService = {
  async start(userId: string, conversationId: string, raw: RecognitionRequest, retryOf?: string): Promise<RecognitionView> {
    const input = RecognitionRequest.parse(raw);
    if (new Set(input.attachmentIds).size !== input.attachmentIds.length) throw invalidFormat('附件不能重复');
    return db.$transaction(async (tx) => {
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId, userId } });
      if (!conversation?.activeSubjectId) throw notFound('会话');
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      const materialType = input.attemptId ? 'answer' : input.subjectRevisionId ? 'process' : 'question';
      const attempt = materialType === 'answer' ? await tx.practiceAttempt.findFirst({ where: { id: input.attemptId, userId,
        artifact: { conversationId, subjectRevisionId: input.subjectRevisionId } }, include: { artifact: { include: { subjectRevision: true } } } }) : null;
      if (materialType === 'answer' && (!attempt || !(attempt.exerciseIds as string[]).includes(input.exerciseId!))) throw notFound('练习题目');
      if (attempt && attempt.stage !== 'doing') throw invalidFormat('提交后不能再提取作答文字');
      const digest = createHash('sha256').update(JSON.stringify({ ...input, requestId: undefined })).digest('hex');
      const key = retryOf ? `recognition:retry:${retryOf}` : `recognition:${conversationId}:${digest}`;
      const previous = await tx.generationJob.findUnique({ where: { idempotencyKey: key } });
      if (previous) return recognitionView(previous);
      await assertIdle(tx, conversationId);
      const subjectId = attempt?.artifact.subjectRevision.subjectId ?? conversation.activeSubjectId;
      const latest = await tx.subjectRevision.findFirst({ where: { subjectId }, orderBy: { version: 'desc' } });
      if (materialType === 'answer' && latest?.id !== input.subjectRevisionId) throw revisionConflict('练习来源已更新，请回原轮次查看作答');
      if (materialType === 'question' && latest) throw revisionConflict('请新建对话上传新的题目');
      if (materialType === 'process' && (!latest?.confirmedAt || latest.id !== input.subjectRevisionId)) throw revisionConflict('请先核对当前题目，再上传过程');
      const attachments = await tx.attachment.findMany({ where: { id: { in: input.attachmentIds }, userId, status: 'ready' } });
      if (attachments.length !== input.attachmentIds.length) throw invalidFormat('图片未上传完成或不属于当前账号');
      for (const a of attachments) {
        const scope = a.scope as { conversationId?: string; subjectRevisionId?: string; attemptId?: string; exerciseId?: string } | null;
        if (scope?.conversationId !== conversationId || scope?.subjectRevisionId !== input.subjectRevisionId ||
          (materialType === 'answer' ? a.purpose !== 'answer_photo' || scope.attemptId !== input.attemptId || scope.exerciseId !== input.exerciseId :
            materialType === 'process' ? a.purpose !== 'process_photo' : !['question_origin', 'knowledge_material'].includes(a.purpose))) throw invalidFormat('图片来源与当前任务不匹配');
      }
      if (attempt) {
        const answer = await tx.practiceAnswer.findUnique({ where: { attemptId_exerciseId: { attemptId: attempt.id, exerciseId: input.exerciseId! } } });
        if (!input.attachmentIds.every((id) => (answer?.photoIds as string[] | undefined)?.includes(id))) throw invalidFormat('请先保存本题作答照片');
      }
      const job = await tx.generationJob.create({ data: { type: 'recognition', conversationId, subjectId,
        subjectRevisionId: latest?.id, idempotencyKey: key, retryOfJobId: retryOf,
        payload: { ...input, materialType } as Prisma.InputJsonValue, deadlineAt: new Date(Date.now() + env().JOB_TOTAL_MS) } });
      return recognitionView(job);
    });
  },
  async get(userId: string, conversationId: string, jobId: string) {
    const job = await db.generationJob.findFirst({ where: { id: jobId, type: 'recognition', conversationId, conversation: { userId } } });
    if (!job) throw notFound('识别任务');
    const view = recognitionView(job);
    if (view.transcriptId) {
      const transcript = await db.processTranscript.findFirst({ where: { id: view.transcriptId, conversationId } });
      if (transcript) {
        view.transcriptConfirmed = transcript.status === 'confirmed';
        if (view.transcriptConfirmed) view.confirmedSteps = transcript.confirmedSteps as string[];
      }
    }
    return view;
  },
  async action(userId: string, conversationId: string, jobId: string, action: 'cancel' | 'retry') {
    const job = await db.generationJob.findFirst({ where: { id: jobId, type: 'recognition', conversationId, conversation: { userId } } });
    if (!job) throw notFound('识别任务');
    if (action === 'retry') {
      if (!['failed', 'cancelled'].includes(job.status)) throw invalidFormat('只能重新读取失败或已取消的图片');
      return this.start(userId, conversationId, job.payload as unknown as RecognitionRequest, job.id);
    }
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      await tx.generationJob.updateMany({ where: { id: job.id, status: { in: ['queued', 'running'] } },
        data: { status: 'cancelled', leasedBy: null, leasedUntil: null, step: null } });
    });
    return this.get(userId, conversationId, job.id);
  },
};
