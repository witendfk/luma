import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();

/** Real GPT + local worker check; only run explicitly, never part of the default test suite. */
async function main() {
  const { db } = await import('../src/lib/db');
  const { runService } = await import('../src/services/run.service');
  const { drive } = await import('../src/agent/loop');
  const { Lesson } = await import('@luma/shared');
  const conversationId = process.argv[2];
  if (!conversationId) throw new Error('需要指定开发会话 ID');
  try {
    const convo = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    if (process.argv.includes('--verify-latest')) {
      const job = await db.generationJob.findFirstOrThrow({ where: { conversationId, type: 'lesson' }, orderBy: { createdAt: 'desc' } });
      assert.equal(job.status, 'succeeded');
      const source = (job.payload as any).sourceLesson;
      const original = await db.artifact.findUniqueOrThrow({ where: { id: source.artifactId } });
      const result = await db.artifact.findUniqueOrThrow({ where: { id: job.resultArtifactId! } });
      const rewritten = Lesson.parse((result.content as any).lesson);
      assert.deepEqual(Lesson.parse((original.content as any).lesson), source.lesson);
      assert.ok(result.version > source.artifactVersion);
      assert.deepEqual(rewritten.sections.filter((s) => s.id !== source.sectionId), source.lesson.sections.filter((s: any) => s.id !== source.sectionId));
      assert.deepEqual(rewritten.diagrams, source.lesson.diagrams);
      const run = await db.agentRun.findUniqueOrThrow({ where: { id: job.runId! } });
      assert.ok(['completed', 'waiting_user'].includes(run.status));
      console.log(JSON.stringify({ pass: true, jobId: job.id, runStatus: run.status, sourceVersion: source.artifactVersion, version: result.version,
        sectionId: source.sectionId, untouchedSectionsPreserved: true, diagramsPreserved: true, originalPreserved: true,
        estimatedInputTokens: (run.policySnapshot as any)?.estimatedInputTokens }));
      return;
    }
    if (process.argv.includes('--status')) {
      const job = await db.generationJob.findFirst({ where: { conversationId, type: 'lesson' }, orderBy: { createdAt: 'desc' } });
      const run = job?.runId ? await db.agentRun.findUnique({ where: { id: job.runId } }) : null;
      const revision = convo.activeSubjectId ? await db.subjectRevision.findFirst({ where: { subjectId: convo.activeSubjectId }, orderBy: { version: 'desc' } }) : null;
      console.log(JSON.stringify({ jobId: job?.id, jobStatus: job?.status, step: job?.step, error: job?.error,
        checkpoint: (job?.draftCheckpoint as { step?: string } | null)?.step, runStatus: run?.status, teachingState: revision?.teachingState }));
      return;
    }
    const source = await db.artifact.findFirstOrThrow({ where: { conversationId, type: 'lesson', publishStatus: 'published', subjectRevision: { subjectId: convo.activeSubjectId! } }, orderBy: { version: 'desc' } });
    const lesson = Lesson.parse((source.content as { lesson?: unknown }).lesson);
    const sectionId = lesson.sections.find((s) => !lesson.diagrams.some((d) => d.sectionId === s.id))!.id;
    const revision = await db.subjectRevision.findUniqueOrThrow({ where: { id: source.subjectRevisionId } });
    const retry = process.argv.includes('--retry-current') ? await db.agentRun.findFirstOrThrow({ where: { conversationId, status: 'failed', error: { path: ['code'], equals: 'CONTEXT_LIMIT' } }, orderBy: { startedAt: 'desc' } }) : null;
    const started = await runService.startRun(convo.userId, convo.id, retry ? { requestId: `reading_retry_${randomUUID()}`, retryOfRunId: retry.id } : { requestId: `reading_live_${randomUUID()}`, subjectId: revision.subjectId,
      expectedRevision: revision.version, artifactId: source.id, artifactVersion: source.version, sectionId,
      action: 'generate_lesson', text: `请给「${lesson.sections.find((s) => s.id === sectionId)!.heading}」换一个更直观的小例子并更新这一节，保留其他小节和配图。不直接给出原题答案。` });
    const messageCount = await db.message.count({ where: { conversationId, role: 'user' } });
    await drive(started.run.id);
    let job = await db.generationJob.findFirst({ where: { runId: started.run.id } });
    assert.ok(job, '运行必须创建局部讲义任务');
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !['succeeded', 'failed', 'cancelled', 'superseded'].includes(job.status)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      job = await db.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    }
    assert.equal(job.status, 'succeeded', `讲义任务状态 ${job.status}`);
    const result = await db.artifact.findUniqueOrThrow({ where: { id: job.resultArtifactId! } });
    const rewritten = Lesson.parse((result.content as { lesson?: unknown }).lesson);
    assert.ok(result.version > source.version);
    assert.ok(!isDeepStrictEqual(rewritten.sections.find((s) => s.id === sectionId), lesson.sections.find((s) => s.id === sectionId)), '目标段落必须有实际变化');
    assert.deepEqual(rewritten.sections.filter((s) => s.id !== sectionId), lesson.sections.filter((s) => s.id !== sectionId));
    assert.deepEqual(rewritten.diagrams, lesson.diagrams);
    assert.deepEqual((await db.artifact.findUniqueOrThrow({ where: { id: source.id } })).content, source.content);
    await drive(started.run.id);
    let run = await db.agentRun.findUniqueOrThrow({ where: { id: started.run.id } });
    const resumeDeadline = Date.now() + 90000;
    while (['running', 'waiting_job'].includes(run.status) && Date.now() < resumeDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      run = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    }
    assert.ok(['completed', 'waiting_user'].includes(run.status), `Agent 恢复状态 ${run.status}`);
    const memory = await db.subjectRevision.findUniqueOrThrow({ where: { id: revision.id } });
    assert.ok(memory.teachingState);
    console.log(JSON.stringify({ pass: true, runId: run.id, jobId: job.id, sourceArtifactId: source.id, artifactId: result.id,
      sectionId, sourceVersion: source.version, version: result.version, untouchedSectionsPreserved: true, diagramPreserved: true,
      oldArtifactPreserved: true, teachingStateSaved: true, runStatus: run.status }));
    if (retry) assert.equal(await db.message.count({ where: { conversationId, role: 'user' } }), messageCount, '重试不能重复学生消息');
  } finally { await db.$disconnect(); }
}
main().catch((err) => { console.error('FAIL 真实局部重讲验证：', err instanceof assert.AssertionError ? err.message : '检查任务/模型运行状态，不输出凭据'); process.exitCode = 1; });
