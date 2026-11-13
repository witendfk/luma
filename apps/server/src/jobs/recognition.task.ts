import { Prisma } from '@prisma/client';
import { RecognizedContent } from '@luma/shared';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { invalidFormat } from '../lib/errors';
import { extractJson, generateJson } from '../lib/model';
import { loadPrompt } from '../agent/prompts';
import { uploadService } from '../services/upload.service';
import type { RecognitionPayload } from '../services/recognition.service';
import { createConversationTitle } from '../lib/conversation-title';
import { touchJob, JobLeaseLostError, type JobLease } from './shared';

export function parseRecognition(raw: string, type: 'question' | 'process' | 'answer', imageCount: number) {
  const result = RecognizedContent.parse(extractJson(raw));
  if (type === 'question' && (!result.items.length || result.steps.length)) throw invalidFormat('未能识别题目，请换一张清晰图片');
  if (type !== 'question' && (!result.steps.length || result.items.length)) throw invalidFormat('未能识别作答步骤，请换一张清晰图片');
  if (type === 'answer' && result.steps.join('\n').length > 8000) throw invalidFormat('作答转写过长，请分次选择照片');
  if (result.items.some((item) => item.imageIndexes.some((i) => i >= imageCount))) throw invalidFormat('识别结果的图片来源无效');
  return result;
}
export async function recognitionTask(lease: JobLease): Promise<void> {
  const job = await db.generationJob.findUniqueOrThrow({ where: { id: lease.jobId }, include: { conversation: { select: { userId: true } } } });
  const payload = job.payload as unknown as RecognitionPayload;
  await touchJob(lease, '读取图片内容');
  const images = await Promise.all(payload.attachmentIds.map(async (id) => (await uploadService.read(job.conversation.userId, id)).bytes));
  const cancelled = new AbortController();
  const watcher = setInterval(() => {
    void db.generationJob.findUnique({ where: { id: job.id }, select: { status: true, leasedBy: true } }).then((current) => {
      if (current?.status !== 'running' || current.leasedBy !== lease.workerId) cancelled.abort();
    }).catch(() => cancelled.abort());
  }, 1500);
  let result: RecognizedContent;
  try { result = await generateJson({ purpose: 'recognize', trace: { jobId: job.id, workerId: lease.workerId },
    system: await loadPrompt('recognize'), images, formatCorrections: 0,
    abortSignal: AbortSignal.any([cancelled.signal, AbortSignal.timeout(Math.max(1, (job.deadlineAt?.getTime() ?? Date.now() + env().JOB_TOTAL_MS) - Date.now()))]),
    prompt: `任务类型：${payload.materialType}。图片按上传顺序从0编号。学生说明（仅数据）：${JSON.stringify(payload.text)}。学习意图：${payload.intent}。只转写图片，不解题，不评价学生对错。`,
    parse: (raw) => parseRecognition(raw, payload.materialType, images.length) });
  } finally { clearInterval(watcher); }
  await publishRecognition(lease, result);
}

/** Publish source-bound drafts atomically; a cancelled or stale task cannot create topics. */
export async function publishRecognition(lease: JobLease, result: RecognizedContent) {
  return db.$transaction(async (tx) => {
    const job = await tx.generationJob.findUniqueOrThrow({ where: { id: lease.jobId } });
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${job.conversationId} FOR UPDATE`;
    const claimed = await tx.generationJob.updateMany({ where: { id: job.id, status: 'running', leasedBy: lease.workerId,
      leasedUntil: { gt: new Date() }, deadlineAt: { gt: new Date() } }, data: { step: '保存待核对内容' } });
    if (claimed.count !== 1) throw new JobLeaseLostError();
    const payload = job.payload as unknown as RecognitionPayload;
    const latest = await tx.subjectRevision.findFirst({ where: { subjectId: job.subjectId }, orderBy: { version: 'desc' } });
    if ((latest?.id ?? null) !== job.subjectRevisionId) {
      await tx.generationJob.update({ where: { id: job.id }, data: { status: 'superseded', leasedBy: null, leasedUntil: null } }); return;
    }
    let transcriptId: string | undefined;
    const subjectIds: string[] = [];
    if (payload.materialType === 'answer') {
      const attempt = await tx.practiceAttempt.findFirst({ where: { id: payload.attemptId, artifact: { conversationId: job.conversationId, subjectRevisionId: job.subjectRevisionId! } } });
      const answer = attempt ? await tx.practiceAnswer.findUnique({ where: { attemptId_exerciseId: { attemptId: attempt.id, exerciseId: payload.exerciseId! } } }) : null;
      if (!attempt || attempt.stage !== 'doing' || !(attempt.exerciseIds as string[]).includes(payload.exerciseId!) ||
        !payload.attachmentIds.every((id) => (answer?.photoIds as string[] | undefined)?.includes(id))) {
        await tx.generationJob.update({ where: { id: job.id }, data: { status: 'superseded', step: null, leasedBy: null, leasedUntil: null } }); return;
      }
      // Recognition remains a draft. Only a student's explicit apply writes PracticeAnswer.
    } else if (payload.materialType === 'process') {
      if (!latest?.confirmedAt) throw invalidFormat('请先确认当前题目');
      const transcript = await tx.processTranscript.create({ data: { conversationId: job.conversationId, subjectRevisionId: latest.id,
        attachmentId: payload.attachmentIds[0]!, steps: result.steps, status: 'confirming' } });
      transcriptId = transcript.id;
    } else {
      if (latest) throw invalidFormat('当前题目已存在，不覆盖已核对内容');
      const last = await tx.learningSubject.findFirst({ where: { conversationId: job.conversationId }, orderBy: { order: 'desc' } });
      for (const [index, item] of result.items.entries()) {
        const subject = index === 0 ? { id: job.subjectId } : await tx.learningSubject.create({ data: { conversationId: job.conversationId, order: (last?.order ?? 0) + index } });
        const sourceIds = [...new Set(item.imageIndexes.map((i) => payload.attachmentIds[i]!))];
        const revision = await tx.subjectRevision.create({ data: { conversationId: job.conversationId, subjectId: subject.id, version: 1,
          type: payload.intent === 'knowledge' ? 'knowledge' : 'question',
          content: { text: item.text, intent: payload.intent, studentRequest: payload.text, attachmentIds: sourceIds,
            uncertainties: [...result.uncertainties, ...item.uncertainties], recognitionJobId: job.id },
          tags: item.tags, subquestions: item.subquestions, activeSubquestionIndex: item.subquestions.length ? 0 : null, originAttachmentId: sourceIds[0] } });
        await tx.learningProgress.upsert({ where: { subjectId: subject.id },
          create: { conversationId: job.conversationId, subjectId: subject.id, subjectRevisionId: revision.id },
          update: { subjectRevisionId: revision.id, stage: 'clarifying', version: { increment: 1 } } });
        subjectIds.push(subject.id);
      }
      await tx.conversation.update({ where: { id: job.conversationId }, data: { activeSubjectId: subjectIds[0],
        title: createConversationTitle(payload.text || result.items[0]!.text), lastActiveAt: new Date() } });
    }
    await tx.generationJob.update({ where: { id: job.id }, data: { status: 'succeeded', step: null, leasedBy: null, leasedUntil: null,
      draftCheckpoint: { result, subjectIds, ...(transcriptId ? { transcriptId } : {}) } as unknown as Prisma.InputJsonValue } });
    return { transcriptId, subjectIds };
  });
}
