import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.LUMA_DEV_FAKE_LOGIN = 'false';
process.env.LUMA_MOCK_AGENT = 'true';

async function main() {
  const { db } = await import('../src/lib/db');
  const { conversationService } = await import('../src/services/conversation.service');
  const { subjectService } = await import('../src/services/subject.service');
  const { runService } = await import('../src/services/run.service');
  const { drive } = await import('../src/agent/loop');
  const { buildPolicy } = await import('../src/agent/policy');
  const { readLearningContext } = await import('../src/agent/tool-executor');
  const { saveTeachingUpdate } = await import('../src/agent/teaching-state');
  const { evidencePack } = await import('../src/agent/teaching-memory');
  const { lessonTask } = await import('../src/jobs/lesson.task');
  const { applyLessonPatch } = await import('../src/jobs/lesson-revision');
  const { Lesson } = await import('@luma/shared');
  const user = await db.user.create({ data: { openid: `dev:reading-check-${randomUUID()}` } });
  try {
    const convo = await conversationService.create(user.id, { initialText: '二次函数的对称轴', subjectType: 'knowledge' });
    let detail = await conversationService.get(user.id, convo.id);
    const objectId = detail.subject!.subjectId;
    await subjectService.update(user.id, convo.id, { action: 'confirm', subjectId: objectId, expectedRevision: 1 });
    detail = await conversationService.get(user.id, convo.id);
    const revision = detail.subject!;
    const lesson = Lesson.parse({ title: '二次函数的对称轴', sections: [
      { id: 's1', heading: '含义', body: '对称轴两侧互为镜像。' }, { id: 's2', heading: '图像', body: '观察曲线的左右对称关系。' }, { id: 's3', heading: '辨析', body: '区分对称轴与函数图像。' },
    ], diagrams: [{ sectionId: 's2', content: { title: '二次函数', graphic: { kind: 'quadratic', a: 1, b: -4, c: 7,
      bounds: { xMin: -2, xMax: 6, yMin: -2, yMax: 20 }, caption: '观察对称轴', revealValues: false }, steps: [{ label: '左', detail: '观察左侧曲线' }, { label: '右', detail: '寻找相同高度' }] } }] });
    const artifact = await db.artifact.create({ data: { conversationId: convo.id, subjectRevisionId: revision.id, type: 'lesson', version: 1, publishStatus: 'published', content: { lesson } } });
    const policy = await buildPolicy({ conversationId: convo.id, subjectId: objectId, focus: { artifactId: artifact.id, artifactVersion: 1, sectionId: 's1' } });
    assert.equal(policy.teachingMode, 'concept');
    await assert.rejects(runService.startRun(user.id, convo.id, { requestId: randomUUID(), text: '追问', artifactId: artifact.id, artifactVersion: 99, sectionId: 's1' }), /版本/);
    await subjectService.progress(user.id, convo.id, objectId, { expectedRevision: 1, expectedVersion: detail.progress!.version, destination: 'reader', artifactId: artifact.id, sectionId: 's2' });
    assert.equal((await conversationService.get(user.id, convo.id)).progress!.currentSectionId, 's2');
    console.log('PASS 概念教学方式、材料版本校验及阅读位置真库恢复');

    const run = await runService.startRun(user.id, convo.id, { requestId: randomUUID(), text: '请给含义这一节换个例子', action: 'generate_lesson', artifactId: artifact.id, artifactVersion: 1, sectionId: 's1' });
    await drive(run.run.id);
    const job = await db.generationJob.findFirstOrThrow({ where: { runId: run.run.id } });
    const payload = job.payload as any;
    assert.equal(payload.sourceLesson.artifactId, artifact.id);
    const patched = applyLessonPatch(payload.sourceLesson, JSON.stringify({ section: { id: 's1', heading: '含义', body: '新的例子' } }));
    assert.deepEqual(patched.sections.slice(1), lesson.sections.slice(1));
    const workerId = `reading-check-${randomUUID()}`;
    await db.generationJob.update({ where: { id: job.id }, data: { status: 'running', leasedBy: workerId, leasedUntil: new Date(Date.now() + 60000) } });
    await lessonTask({ jobId: job.id, workerId });
    const completed = await db.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(completed.status, 'succeeded');
    const updated = await db.artifact.findUniqueOrThrow({ where: { id: completed.resultArtifactId! } });
    assert.equal(updated.version, 2);
    assert.deepEqual((updated.content as any).lesson.sections.slice(1), lesson.sections.slice(1));
    assert.deepEqual((await db.artifact.findUniqueOrThrow({ where: { id: artifact.id } })).content, { lesson });
    await drive(run.run.id);
    console.log('PASS 局部修订快照→worker发布v2→Agent恢复，其他段落/配图及旧成果保留');

    const userMessage = await db.message.create({ data: { conversationId: convo.id, subjectId: objectId, subjectRevisionId: revision.id, role: 'user', content: { blocks: [{ type: 'text', text: '我不懂为什么要找两侧同高度的点' }], focus: policy.focus } } });
    const reply = await db.message.create({ data: { conversationId: convo.id, subjectId: objectId, subjectRevisionId: revision.id, role: 'assistant', content: { blocks: [{ type: 'text', text: '用相同高度定位轴两侧的对应点。' }], focus: policy.focus } } });
    await db.$transaction((tx) => saveTeachingUpdate(tx, { revisionId: revision.id, userMessageId: userMessage.id, messageId: reply.id, policy, update: { difficulty: '为何选择同高度点', method: '比较轴两侧对应点' } }));
    const state = await evidencePack({ userId: user.id, conversationId: convo.id, policy });
    assert.ok(state!.items.some((n) => JSON.stringify(n.evidence).includes(reply.id)));
    await db.message.createMany({ data: Array.from({ length: 14 }, (_, i) => ({ conversationId: convo.id, subjectId: objectId, subjectRevisionId: revision.id, role: 'user' as const, content: { blocks: [{ type: 'text', text: `后续消息${i}` }], focus: policy.focus } })) });
    let cursor: string | undefined, found = false;
    const ctx = { userId: user.id, conversationId: convo.id, policy };
    for (let i = 0; i < 6; i++) {
      const page = await readLearningContext(ctx, { ref: 'messages', beforeMessageId: cursor, limit: 5 }) as any;
      if (page.messages.some((m: any) => m.id === userMessage.id)) found = true;
      cursor = page.nextCursor; if (!cursor) break;
    }
    assert.ok(found, '旧消息必须能通过游标回读');
    for (let i = 0; i < 20; i++) {
      const round = await runService.startRun(user.id, convo.id, { requestId: randomUUID(), text: `第${i + 1}轮：再用同高度点解释对称轴`,
        artifactId: artifact.id, artifactVersion: 1, sectionId: 's1' });
      assert.equal((round.run.counters as any).decisions, 0, '每次学生输入重新计数，不设总会话轮数上限');
      await drive(round.run.id);
      const saved = await db.agentRun.findUniqueOrThrow({ where: { id: round.run.id } });
      assert.ok(['completed', 'waiting_user'].includes(saved.status), '20轮应能持续教学');
      if (i === 19) assert.ok((saved.taskFrame as any).historyCount > 40, '历史不再被截为12条');
    }
    console.log('PASS 20轮真库/模型mock连续教学，历史超过40条，每轮预算独立，未出现三四轮上限');
    const other = await subjectService.create(user.id, convo.id, { type: 'question', content: { text: '另一个独立问题' } });
    const otherMessage = await db.message.create({ data: { conversationId: convo.id, subjectId: other.subject.subjectId, subjectRevisionId: other.subject.id, role: 'user', content: { blocks: [] } } });
    assert.equal((await readLearningContext(ctx, { ref: 'messages', beforeMessageId: otherMessage.id }) as any).ok, false);
    await subjectService.update(user.id, convo.id, { action: 'update', subjectId: objectId, expectedRevision: 1, content: { text: '修改后的学习内容' } });
    const next = await conversationService.get(user.id, convo.id);
    assert.equal((await db.subjectRevision.findUniqueOrThrow({ where: { id: next.subject!.id } })).teachingState, null);
    console.log('PASS 教学进展持久化与证据、长对话回读、跨对象游标拒绝、新版本不继承旧记忆');
  } finally {
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
}
main().catch(() => { console.error('FAIL B04-R 集成检查；检查本机服务和失败断言，不输出凭据'); process.exitCode = 1; });
