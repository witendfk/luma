import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
const schema = `uploads_check_${randomUUID().replaceAll('-', '')}`;
const originalUrl = process.env.DATABASE_URL!, admin = new PrismaClient({ datasourceUrl: originalUrl });
const url = new URL(originalUrl); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.toString();
const files: string[] = [];
async function main() {
  let db: PrismaClient | undefined;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    db = (await import('../src/lib/db')).db;
    const { uploadService } = await import('../src/services/upload.service');
    const { recognitionService } = await import('../src/services/recognition.service');
    const { conversationService } = await import('../src/services/conversation.service');
    const { subjectService } = await import('../src/services/subject.service');
    const { publishRecognition } = await import('../src/jobs/recognition.task');
    const { JobLeaseLostError } = await import('../src/jobs/shared');
    await db.user.createMany({ data: [{ id: 'u', openid: `u-${schema}` }, { id: 'other', openid: `other-${schema}` }] });
    const conversation = await conversationService.create('u', {});
    const bytes = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'white' } }).png().toBuffer();
    async function upload(purpose: 'question_origin' | 'process_photo', revision?: string) {
      const ticket = await uploadService.create('u', { purpose, format: 'png', sizeBytes: bytes.length,
        scope: { conversationId: conversation.id, subjectRevisionId: revision } });
      files.push(ticket.objectKey, ticket.objectKey.replace('.original', '.vision.png'));
      await assert.rejects(uploadService.write('other', ticket.uploadId, bytes));
      await assert.rejects(uploadService.read('u', ticket.uploadId));
      await uploadService.write('u', ticket.uploadId, bytes);
      await assert.rejects(uploadService.complete('u', ticket.uploadId, { objectKey: 'wrong' }));
      const complete = await uploadService.complete('u', ticket.uploadId, { objectKey: ticket.objectKey });
      assert.deepEqual(await uploadService.complete('u', ticket.uploadId, { objectKey: ticket.objectKey }), complete);
      assert.ok((await uploadService.read('u', complete.attachmentId)).bytes.length);
      await assert.rejects(uploadService.write('u', ticket.uploadId, bytes));
      return complete.attachmentId;
    }
    const attachment = await upload('question_origin');
    const request = { requestId: 'request-one', attachmentIds: [attachment], text: '这些题我不太会', intent: 'question' as const };
    const job = await recognitionService.start('u', conversation.id, request);
    assert.equal((await recognitionService.start('u', conversation.id, request)).id, job.id);
    await assert.rejects(recognitionService.get('other', conversation.id, job.id));
    await db.generationJob.update({ where: { id: job.id }, data: { status: 'running', leasedBy: 'check', leasedUntil: new Date(Date.now() + 60_000) } });
    const result = { items: [
      { text: '题一。（1）小问一；（2）小问二', subquestions: ['小问一', '小问二'], imageIndexes: [0], uncertainties: ['请核对符号'], tags: ['函数'] },
      { text: '独立题二', subquestions: [], imageIndexes: [0], uncertainties: [], tags: [] },
    ], steps: [], uncertainties: [] };
    await publishRecognition({ jobId: job.id, workerId: 'check' }, result);
    const detail = await conversationService.get('u', conversation.id);
    assert.equal(detail.subjects.length, 2); assert.equal(detail.subject!.confirmedAt, null);
    assert.equal(detail.subject!.subquestions && (detail.subject!.subquestions as string[]).length, 2);
    assert.equal(detail.recognition?.status, 'succeeded');
    assert.equal((detail.subject!.content as any).studentRequest, request.text);
    assert.equal(await db.artifact.count(), 0); assert.equal(await db.agentRun.count(), 0);
    await assert.rejects(publishRecognition({ jobId: job.id, workerId: 'check' }, result), JobLeaseLostError);
    const subject = detail.subject!;
    await subjectService.update('u', conversation.id, { action: 'confirm', subjectId: subject.subjectId, expectedRevision: subject.version });
    const processImage = await upload('process_photo', subject.id);
    const processInput = { requestId: 'process-request', attachmentIds: [processImage], subjectRevisionId: subject.id, intent: 'question' as const, text: '' };
    const processJob = await recognitionService.start('u', conversation.id, processInput);
    await db.generationJob.update({ where: { id: processJob.id }, data: { status: 'running', leasedBy: 'check', leasedUntil: new Date(Date.now() + 60_000) } });
    const published = await publishRecognition({ jobId: processJob.id, workerId: 'check' }, { items: [], steps: ['第一步', '第二步'], uncertainties: ['请核对第二行'] });
    assert.ok(published?.transcriptId);
    const transcriptId = published!.transcriptId!;
    assert.equal((await db.processTranscript.findUniqueOrThrow({ where: { id: transcriptId } })).status, 'confirming');
    assert.equal((await recognitionService.get('u', conversation.id, processJob.id)).transcriptConfirmed, false);
    await subjectService.confirmTranscript('u', conversation.id, transcriptId, { confirmedSteps: ['第一步', '修正的第二步'] });
    const confirmedView = await recognitionService.get('u', conversation.id, processJob.id);
    assert.equal(confirmedView.transcriptConfirmed, true);
    assert.deepEqual(confirmedView.confirmedSteps, ['第一步', '修正的第二步']);
    await subjectService.confirmTranscript('u', conversation.id, transcriptId, { confirmedSteps: ['第一步', '修正的第二步'] });
    await assert.rejects(subjectService.confirmTranscript('u', conversation.id, transcriptId, { confirmedSteps: ['覆盖旧步骤'] }));
    await db.conversation.update({ where: { id: conversation.id }, data: { activeSubjectId: detail.subjects.find((item) => item.id !== subject.subjectId)!.id } });
    await assert.rejects(subjectService.confirmTranscript('u', conversation.id, transcriptId, { confirmedSteps: ['第一步', '修正的第二步'] }), /当前题目已切换/);
    await db.conversation.update({ where: { id: conversation.id }, data: { activeSubjectId: subject.subjectId } });
    // Answer recognition is scoped to the exact exercise/round, and publishes only a draft.
    const { practiceService } = await import('../src/services/practice.service');
    const practiceSet = await db.artifact.create({ data: { conversationId: conversation.id, subjectRevisionId: subject.id,
      type: 'exercise_set', version: 1, publishStatus: 'published', content: {}, exercises: { create: [1, 2].map((order) => ({
        order, stem: `${order}+1=?`, topic: '隔离检查', difficulty: 'basic', purpose: '转写核对', answer: `${order + 1}`, analysis: '加一',
      })) } }, include: { exercises: { orderBy: { order: 'asc' } } } });
    const attempt = await practiceService.start('u', { artifactId: practiceSet.id });
    const answerScope = { conversationId: conversation.id, subjectRevisionId: subject.id, attemptId: attempt.id, exerciseId: practiceSet.exercises[0]!.id };
    const answerTicket = await uploadService.create('u', { purpose: 'answer_photo', scope: answerScope, format: 'png', sizeBytes: bytes.length });
    files.push(answerTicket.objectKey, answerTicket.objectKey.replace('.original', '.vision.png'));
    await uploadService.write('u', answerTicket.uploadId, bytes);
    const answerPhoto = (await uploadService.complete('u', answerTicket.uploadId, { objectKey: answerTicket.objectKey })).attachmentId;
    const answerInput = { requestId: 'answer-request', attachmentIds: [answerPhoto], ...answerScope, text: '', intent: 'practice' as const };
    await assert.rejects(recognitionService.start('other', conversation.id, answerInput));
    await assert.rejects(recognitionService.start('u', conversation.id, answerInput), /保存本题作答照片/);
    await practiceService.saveAnswer('u', attempt.id, answerScope.exerciseId, { textDraft: '学生已有文字', photoIds: [answerPhoto], draftVersion: 1 });
    await assert.rejects(recognitionService.start('u', conversation.id, { ...answerInput, exerciseId: practiceSet.exercises[1]!.id }), /来源/);
    const answerJob = await recognitionService.start('u', conversation.id, answerInput);
    assert.equal((await recognitionService.start('u', conversation.id, answerInput)).id, answerJob.id);
    await db.generationJob.update({ where: { id: answerJob.id }, data: { status: 'running', leasedBy: 'check', leasedUntil: new Date(Date.now() + 60_000) } });
    await publishRecognition({ jobId: answerJob.id, workerId: 'check' }, { items: [], steps: ['1+1=3'], uncertainties: ['请核对原稿的结果'] });
    const answerView = await recognitionService.get('u', conversation.id, answerJob.id);
    assert.equal(answerView.materialType, 'answer'); assert.deepEqual(answerView.steps, ['1+1=3']);
    assert.equal(await db.processTranscript.count(), 1, '正式作答不创建全局过程转写');
    assert.equal((await practiceService.get('u', attempt.id)).exercises[0]!.myAnswer!.textDraft, '学生已有文字', '识别成功不自动覆盖作答');
    const lateAnswerJob = await recognitionService.start('u', conversation.id, { ...answerInput, text: '迟到结果检查' });
    await db.generationJob.update({ where: { id: lateAnswerJob.id }, data: { status: 'running', leasedBy: 'check', leasedUntil: new Date(Date.now() + 60_000) } });
    await practiceService.submit('u', attempt.id);
    await publishRecognition({ jobId: lateAnswerJob.id, workerId: 'check' }, { items: [], steps: ['迟到作答'], uncertainties: [] });
    assert.equal((await recognitionService.get('u', conversation.id, lateAnswerJob.id)).status, 'superseded');
    await assert.rejects(recognitionService.start('u', conversation.id, answerInput), /提交后/);
    const second = await recognitionService.start('u', conversation.id, { ...processInput, text: '再次检查' });
    await db.generationJob.update({ where: { id: second.id }, data: { status: 'running', leasedBy: 'check', leasedUntil: new Date(Date.now() + 60_000) } });
    await recognitionService.action('u', conversation.id, second.id, 'cancel');
    await assert.rejects(publishRecognition({ jobId: second.id, workerId: 'check' }, { items: [], steps: ['迟到步骤'], uncertainties: [] }), JobLeaseLostError);
    assert.equal(await db.processTranscript.count(), 1);
    const retry = await recognitionService.action('u', conversation.id, second.id, 'retry');
    assert.equal((await recognitionService.action('u', conversation.id, second.id, 'retry')).id, retry.id);
    await subjectService.update('u', conversation.id, { action: 'update', subjectId: subject.subjectId, expectedRevision: 1, content: { text: '修订题干' } });
    await assert.rejects(subjectService.confirmTranscript('u', conversation.id, transcriptId, { confirmedSteps: ['第一步', '修正的第二步'] }));
    assert.equal((await db.generationJob.findUniqueOrThrow({ where: { id: retry.id } })).status, 'superseded');
    console.log('PASS 隔离真库：私有文件、多题核对、过程确认、作答转写归属/去重/不覆盖原文/提交后迟到拒绝、取消重试与版本隔离；零模型调用');
  } finally {
    await db?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.$disconnect();
    for (const key of files) await unlink(path.join(process.cwd(), '.luma', 'uploads', key)).catch(() => {});
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
