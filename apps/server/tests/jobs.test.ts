import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from '../src/lib/db';
import { JobLeaseLostError, publishArtifact, touchJob, failJob } from '../src/jobs/shared';
import { replaceMethod } from './helpers/mock';

process.env.DATABASE_URL = 'postgresql://review:review@localhost:5432/review';
delete process.env.OPENAI_BASE_URL;

const lease = { jobId: 'job-A', workerId: 'worker-A' };

function fixture(t: any, patch: Record<string, unknown> = {}, latestSubject = 'subject-A') {
  const initial = {
    id: 'job-A', conversationId: 'conversation-A', subjectRevisionId: 'subject-A',
    type: 'lesson', status: 'running', leasedBy: 'worker-A', leasedUntil: new Date(Date.now() + 60_000),
    ...patch,
  };
  let job: any = { ...initial };
  const artifacts: any[] = [];
  let failCompletion = false;
  const update = (state: any, { where, data }: any) => {
    const matches = state.id === where.id && state.status === where.status && state.leasedBy === where.leasedBy &&
      state.leasedUntil && state.leasedUntil > where.leasedUntil.gt;
    if (!matches || (failCompletion && data.status === 'succeeded')) return { count: 0 };
    Object.assign(state, data);
    return { count: 1 };
  };
  replaceMethod(t, db.generationJob, 'updateMany', async (args: any) => update(job, args));
  replaceMethod(t, db, '$transaction', async (callback: any) => {
    const staged = { ...job };
    const pending: any[] = [];
    let locked = false;
    const result = await callback({
      $queryRaw: async () => { locked = true; return [{ id: job.conversationId }]; },
      generationJob: {
        findUniqueOrThrow: async () => ({ ...staged }),
        updateMany: async (args: any) => { assert.equal(locked, true); return update(staged, args); },
        update: async ({ data }: any) => Object.assign(staged, data),
      },
      subjectRevision: { findFirst: async () => ({ id: latestSubject }) },
      artifact: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          const artifact = { id: 'artifact-A', ...data };
          pending.push(artifact);
          return artifact;
        },
      },
    });
    job = staged;
    artifacts.push(...pending);
    return result;
  });
  return { artifacts, get job() { return job; }, failCompletion() { failCompletion = true; } };
}

for (const [name, patch] of [
  ['已取消', { status: 'cancelled' }],
  ['已失效', { status: 'superseded' }],
  ['其他 worker', { leasedBy: 'worker-B' }],
  ['租约过期', { leasedUntil: new Date(0) }],
] as const) {
  test(`${name}的任务不能续租、写失败或发布成果`, async (t) => {
    const f = fixture(t, patch);
    await assert.rejects(touchJob(lease), JobLeaseLostError);
    await failJob(lease, 'TEST', 'failure', false);
    await assert.rejects(publishArtifact(lease, 'lesson', {}), JobLeaseLostError);
    assert.equal(f.artifacts.length, 0);
    assert.equal(f.job.status, 'status' in patch ? patch.status : 'running');
  });
}

test('题目更新后旧任务标记 superseded，不发布旧版本材料', async (t) => {
  const f = fixture(t, {}, 'subject-B');
  assert.equal(await publishArtifact(lease, 'lesson', {}), null);
  assert.equal(f.job.status, 'superseded');
  assert.equal(f.artifacts.length, 0);
});

test('题组、题目及 succeeded 在同一事务中发布，重复发布被拒绝', async (t) => {
  const f = fixture(t, { type: 'exercise_set' });
  const exercises = [1, 2].map((order) => ({ order, stem: 'test', topic: 'test', difficulty: 'basic', purpose: 'test', answer: '1', analysis: 'test' }));
  assert.equal(await publishArtifact(lease, 'exercise_set', { count: 2 }, exercises), 'artifact-A');
  assert.equal(f.job.status, 'succeeded');
  assert.equal(f.artifacts[0].exercises.create.length, 2);
  await assert.rejects(publishArtifact(lease, 'exercise_set', {}), JobLeaseLostError);
  assert.equal(f.artifacts.length, 1);
});

test('完成前租约失效时，整个成果写入回滚', async (t) => {
  const f = fixture(t);
  f.failCompletion();
  await assert.rejects(publishArtifact(lease, 'lesson', {}), JobLeaseLostError);
  assert.equal(f.artifacts.length, 0);
  assert.equal(f.job.status, 'running');
});
