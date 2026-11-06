import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadWorkerEnv } from '../src/worker/load-env';

loadWorkerEnv();
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.LUMA_DEV_FAKE_LOGIN = 'false';
process.env.LUMA_MOCK_AGENT = 'true';
async function main() {
  const { db } = await import('../src/lib/db');
  const { conversationService: conversations } = await import('../src/services/conversation.service');
  const { subjectService: subjects } = await import('../src/services/subject.service');
  const { collectionService: collections } = await import('../src/services/collection.service');
  const { runService: runs } = await import('../src/services/run.service');
  const { practiceService: practice } = await import('../src/services/practice.service');
  const { publishArtifact } = await import('../src/jobs/shared');
  const { drive } = await import('../src/agent/loop');
  const users = await Promise.all([1, 2].map(() => db.user.create({ data: { openid: `dev:subjects-${randomUUID()}` } })));
  const uid = users[0]!.id, other = users[1]!.id;
  const requestId = () => `test_${randomUUID()}`;
  try {
    const conversation = await conversations.create(uid, { initialText: '第一题：求二次函数最小值' });
    const cid = conversation.id;
    let detail = await conversations.get(uid, cid);
    const first = detail.subject!.subjectId;
    const secondRevision = (await subjects.create(uid, cid, { type: 'knowledge', content: { text: '第二部分：集合的交与并', intent: 'knowledge' } })).subject;
    const second = secondRevision.subjectId;
    assert.notEqual(first, second);
    assert.equal((await conversations.get(uid, cid)).subject!.subjectId, first);
    await subjects.update(uid, cid, { subjectId: first, action: 'confirm', expectedRevision: 1 });
    await subjects.update(uid, cid, { subjectId: second, action: 'update', expectedRevision: 1, content: { text: '第二部分修订：交集的含义' } });
    detail = await conversations.get(uid, cid);
    assert.equal(detail.subject!.version, 1);
    assert.ok(detail.subject!.confirmedAt);
    assert.equal(detail.subjects[1]!.revision!.version, 2);
    assert.equal(detail.subjects[1]!.revision!.confirmedAt, null);
    await assert.rejects(subjects.update(uid, cid, { subjectId: second, action: 'confirm', expectedRevision: 1 }), /已更新/);
    console.log('PASS 多对象版本及核对独立，旧版本请求拒绝');

    const firstProgress = detail.progress!;
    await subjects.progress(uid, cid, first, { expectedRevision: 1, expectedVersion: firstProgress.version, destination: 'chat', draft: '第一题未发送的思路' });
    const run = await runs.startRun(uid, cid, { requestId: requestId(), subjectId: first, expectedRevision: 1, text: '第一题怎么想？' });
    await assert.rejects(subjects.focus(uid, cid, { subjectId: second }), /正在生成/);
    await drive(run.run.id);
    const counts = [await db.agentRun.count({ where: { conversationId: cid } }), await db.generationJob.count({ where: { conversationId: cid } })];
    await subjects.focus(uid, cid, { subjectId: second });
    assert.equal((await conversations.messages(uid, cid, { limit: 30 })).items.length, 0);
    assert.equal((await conversations.get(uid, cid)).progress!.draft, '');
    await assert.rejects(runs.startRun(uid, cid, { requestId: requestId(), subjectId: first, expectedRevision: 1, text: '迟到的第一题输入' }), /已切换/);
    await subjects.update(uid, cid, { subjectId: second, action: 'confirm', expectedRevision: 2 });
    await subjects.focus(uid, cid, { subjectId: first, learnAll: true });
    detail = await conversations.get(uid, cid);
    assert.equal(detail.progress!.draft, '第一题未发送的思路');
    assert.equal(detail.conversation.learnAll, true);
    assert.equal((await conversations.messages(uid, cid, { limit: 30 })).items.length, 2);
    assert.deepEqual([await db.agentRun.count({ where: { conversationId: cid } }), await db.generationJob.count({ where: { conversationId: cid } })], counts);
    console.log('PASS 真库切题/重进恢复草稿和对话；切题不生成，生成中与迟到输入受保护');

    const lesson = await db.artifact.create({ data: { conversationId: cid, subjectRevisionId: detail.subject!.id, type: 'lesson', version: 1, publishStatus: 'published', content: { lesson: { sections: [{ id: 's1', heading: '配方', body: '平方非负' }] } } } });
    const progress = detail.progress!;
    const results = await Promise.allSettled([1, 2].map(() => subjects.progress(uid, cid, first, {
      expectedRevision: 1, expectedVersion: progress.version, destination: 'reader', artifactId: lesson.id, sectionId: 's1',
    })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await conversations.get(uid, cid)).progress!.currentSectionId, 's1');
    await assert.rejects(subjects.progress(uid, cid, second, { expectedRevision: 2, expectedVersion: 1, destination: 'reader', artifactId: lesson.id, sectionId: 's1' }), /不存在/);
    await assert.rejects(runs.startRun(uid, cid, { requestId: requestId(), subjectId: first, expectedRevision: 1, text: '错误章节', artifactId: lesson.id, sectionId: 'missing' }), /不存在/);
    await assert.rejects(subjects.focus(other, cid, { subjectId: first }), /不存在/);
    const otherConversation = await conversations.create(uid, { initialText: '其他会话' });
    await assert.rejects(subjects.focus(uid, otherConversation.id, { subjectId: first }), /不存在/);
    console.log('PASS 阅读定位、并发版本保护、跨题材料/章节与跨账号/会话访问校验');

    await collections.upsert(uid, first, { note: '第一题笔记', reviewStatus: 'reviewed' });
    await collections.upsert(uid, second, { note: '第二题笔记' });
    await collections.remove(uid, first);
    assert.equal((await collections.list(uid, { limit: 20 })).items.length, 1);
    assert.equal((await collections.get(uid, first))!.note, '第一题笔记');
    await collections.upsert(uid, first, {});
    assert.equal((await collections.get(uid, first))!.reviewStatus, 'reviewed');
    assert.equal((await collections.list(uid, { limit: 20, view: 'knowledge', keyword: '交集' })).items[0]!.subjectId, second);
    await assert.rejects(collections.upsert(other, first, {}), /不存在/);
    console.log('PASS 同会话逐题收藏、软取消/重收藏保留笔记，筛选与账号隔离');

    // A newer revision of another object must not invalidate this object's publish.
    const job = await db.generationJob.create({ data: { conversationId: cid, subjectId: first, subjectRevisionId: detail.subject!.id, type: 'exercise_set', status: 'running', leasedBy: 'b01-check', leasedUntil: new Date(Date.now() + 60_000) } });
    const artifactId = await publishArtifact({ jobId: job.id, workerId: 'b01-check' }, 'exercise_set', {}, [{ order: 1, stem: '练习', topic: '函数', difficulty: 'basic', purpose: '巩固', answer: '1', analysis: '平方非负' }]);
    assert.ok(artifactId);
    const attempt = await practice.start(uid, { artifactId: artifactId! });
    assert.equal(attempt.subjectId, first);
    assert.equal(attempt.answersHidden, true);
    assert.equal(attempt.exercises[0]!.myAnswer, null);
    assert.equal((await practice.history(uid, artifactId!))[0]!.id, attempt.id);
    await subjects.update(uid, cid, { subjectId: first, action: 'update', expectedRevision: 1, content: { text: '修改第一题条件' } });
    const staleJob = await db.generationJob.create({ data: { conversationId: cid, subjectId: first, subjectRevisionId: detail.subject!.id, type: 'lesson', status: 'running', leasedBy: 'b01-check', leasedUntil: new Date(Date.now() + 60_000) } });
    assert.equal(await publishArtifact({ jobId: staleJob.id, workerId: 'b01-check' }, 'lesson', {}), null);
    assert.equal((await conversations.get(uid, cid)).progress!.currentArtifactId, null);
    assert.equal((await practice.get(uid, attempt.id)).id, attempt.id);
    console.log('PASS 发布按来源对象核验，旧版任务不发布；修订保留历史材料和练习，练习 DTO 与历史接口一致');

    const time = (await conversations.getOwned(uid, cid)).lastActiveAt.getTime();
    await conversations.update(uid, cid, { archived: true, title: '我的学习' });
    assert.equal((await conversations.getOwned(uid, cid)).lastActiveAt.getTime(), time);
    assert.ok((await conversations.get(uid, cid)).conversation.archivedAt);
    const next = await runs.startRun(uid, cid, { requestId: requestId(), subjectId: first, expectedRevision: 2, text: '继续学习' });
    assert.equal((await conversations.getOwned(uid, cid)).archivedAt, null);
    await runs.cancel(uid, next.run.id);
    console.log('PASS 归档/重命名不修改学习排序，真实新消息在同一事务内恢复归档');
  } finally {
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await db.$disconnect();
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
