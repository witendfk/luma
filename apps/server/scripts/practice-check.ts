import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
Object.assign(process.env, { NODE_ENV: 'test' });

async function main() {
  const { db } = await import('../src/lib/db');
  const { conversationService } = await import('../src/services/conversation.service');
  const { practiceService: practice } = await import('../src/services/practice.service');
  const { ensureLessonPractice, practiceSource, getLessonPractice } = await import('../src/services/lesson-practice');
  const user = await db.user.create({ data: { openid: `dev:practice-check-${randomUUID()}` } });
  try {
    const convo = await conversationService.create(user.id, { initialText: '隔离练习检查', subjectType: 'knowledge' });
    const detail = await conversationService.get(user.id, convo.id);
    const artifact = await db.artifact.create({ data: { conversationId: convo.id, subjectRevisionId: detail.subject!.id,
      type: 'exercise_set', version: 1, publishStatus: 'published', content: {}, exercises: { create: [1, 2].map((i) => ({
        order: i, stem: `${i}+1=?`, topic: '隔离检查', difficulty: 'basic', purpose: '验证协议', answer: String(i + 1), analysis: '加一',
      })) } }, include: { exercises: { orderBy: { order: 'asc' } } } });
    const lesson = await db.artifact.create({ data: { conversationId: convo.id, subjectRevisionId: detail.subject!.id,
      type: 'lesson', version: 1, publishStatus: 'published', content: { lesson: { title: '隔离来源讲义' } } } });
    const source = await practiceSource(db, user.id, lesson.id, 1);
    assert.deepEqual(await getLessonPractice(user.id, lesson.id, 1), { status: 'none' });
    await assert.rejects(getLessonPractice('not-owner', lesson.id, 1));
    await assert.rejects(getLessonPractice(user.id, lesson.id, 2));
    const ensure = () => db.$transaction((tx) => ensureLessonPractice(tx, convo.id, source, () => tx.generationJob.create({ data: {
      type: 'exercise_set', conversationId: convo.id, subjectId: detail.subject!.subjectId, subjectRevisionId: detail.subject!.id,
      status: 'queued', idempotencyKey: `isolated-practice-${randomUUID()}`, payload: { practiceSource: { ...source } },
      // Block the real worker from claiming any isolated fixture. No model is invoked by this script.
      leasedUntil: new Date(Date.now() + 3600000),
    } })));
    const [left, right] = await Promise.all([ensure(), ensure()]);
    assert.equal(left.job.id, right.job.id);
    assert.equal(await db.generationJob.count({ where: { conversationId: convo.id } }), 1);
    assert.equal((await getLessonPractice(user.id, lesson.id, 1)).status, 'queued');
    await db.generationJob.update({ where: { id: left.job.id }, data: { status: 'failed', error: { message: '隔离失败', retryable: true } } });
    assert.equal((await ensure()).job.id, left.job.id, '失败仅复用原任务，不自动重试');
    const retry = await db.generationJob.create({ data: { type: 'exercise_set', conversationId: convo.id, subjectRevisionId: detail.subject!.id,
      subjectId: detail.subject!.subjectId, status: 'queued', retryOfJobId: left.job.id,
      idempotencyKey: `isolated-retry-${randomUUID()}`, payload: { practiceSource: { ...source } }, leasedUntil: new Date(Date.now() + 3600000) } });
    assert.equal((await ensure()).job.id, retry.id);
    await db.generationJob.update({ where: { id: retry.id }, data: { status: 'succeeded', resultArtifactId: artifact.id } });
    assert.equal((await ensure()).artifact!.id, artifact.id);
    assert.equal((await getLessonPractice(user.id, lesson.id, 1) as { artifactId: string }).artifactId, artifact.id);
    const secondLesson = await db.artifact.create({ data: { conversationId: convo.id, subjectRevisionId: detail.subject!.id,
      type: 'lesson', version: 2, publishStatus: 'published', content: {} } });
    assert.deepEqual(await getLessonPractice(user.id, secondLesson.id, 2), { status: 'none' });
    console.log('PASS lesson practice: read-only lookup, source/version ownership, concurrent ensure, failed job reuse, latest retry, published reuse, different lesson isolation; worker-blocked fixtures, no model calls');
    const [a, b] = await Promise.all([practice.start(user.id, { artifactId: artifact.id }), practice.start(user.id, { artifactId: artifact.id })]);
    assert.equal(a.id, b.id);
    assert.equal(await db.practiceAttempt.count({ where: { artifactId: artifact.id } }), 1);
    assert.equal(a.answersHidden, true);
    assert.ok(a.exercises.every((ex) => !('answer' in ex) && !('analysis' in ex)));
    await assert.rejects(practice.get('not-owner', a.id));
    await assert.rejects(practice.start(user.id, { artifactId: artifact.id, exerciseIds: [artifact.exercises[0]!.id, artifact.exercises[0]!.id] }));
    const [first, second] = artifact.exercises;
    const input = { textDraft: '我的第一步', markedUnknown: false, draftVersion: 1 };
    await practice.saveAnswer(user.id, a.id, first!.id, input);
    await practice.saveAnswer(user.id, a.id, first!.id, input);
    await assert.rejects(practice.saveAnswer(user.id, a.id, first!.id, { ...input, textDraft: '过期覆盖' }));
    await practice.position(user.id, a.id, second!.id);
    const resumed = await practice.get(user.id, a.id);
    assert.equal(resumed.currentExerciseId, second!.id);
    assert.equal(resumed.exercises[0]!.myAnswer!.textDraft, input.textDraft);
    await practice.saveAnswer(user.id, a.id, second!.id, { markedUnknown: true, draftVersion: 1 });
    const review = await practice.submit(user.id, a.id);
    assert.equal(review.stage, 'review');
    assert.ok(review.exercises.every((ex) => 'answer' in ex));
    assert.equal((await practice.submit(user.id, a.id)).submittedAt?.toISOString(), review.submittedAt?.toISOString());
    await assert.rejects(practice.saveAnswer(user.id, a.id, first!.id, { textDraft: '提交后改动', draftVersion: 2 }));
    await assert.rejects(practice.complete(user.id, a.id));
    await practice.saveAnswer(user.id, a.id, first!.id, { selfEval: 'independent', draftVersion: 2 });
    await practice.saveAnswer(user.id, a.id, second!.id, { selfEval: 'stuck', draftVersion: 2 });
    await practice.complete(user.id, a.id);
    const finished = await practice.get(user.id, a.id);
    await practice.complete(user.id, a.id);
    assert.equal((await practice.get(user.id, a.id)).completedAt?.toISOString(), finished.completedAt?.toISOString());
    await practice.position(user.id, a.id, first!.id);
    assert.equal((await practice.get(user.id, a.id)).currentExerciseId, second!.id);
    await assert.rejects(practice.saveAnswer(user.id, a.id, first!.id, { selfEval: 'stuck', draftVersion: 3 }));
    assert.equal((await practice.start(user.id, { artifactId: artifact.id })).id, a.id);
    console.log('PASS practice: concurrent start/resume, ownership, answer hiding, draft retry/conflict, position, submit/complete idempotency, self-evaluation, completed round readonly');
  } finally {
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
}
main().catch((err) => { console.error('FAIL practice:', err instanceof Error ? err.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]') : 'unknown'); process.exitCode = 1; });
