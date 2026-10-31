import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { ApiError, toApiError } from '../lib/errors';
import { lessonTask } from './lesson.task';
import { practiceTask } from './practice.task';
import { failJob, JobLeaseLostError, type JobLease } from './shared';

/**
 * 任务执行循环（设计文档 §8.3）。
 * 通过数据库原子领取 + 租约避免多进程重复执行；只读查询不触发模型。
 */

const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;

/** 把租约过期的 running 任务标记为中断，允许学生重试（§8.3：进程重启不精确续跑） */
export async function markExpiredLeases(): Promise<void> {
  const result = await db.generationJob.updateMany({
    where: { status: 'running', leasedUntil: { lt: new Date() } },
    data: {
      status: 'failed',
      error: { code: 'GENERATION_INTERRUPTED', message: '执行进程重启，任务被中断', retryable: true },
      leasedUntil: null,
      leasedBy: null,
    },
  });
  if (result.count > 0) console.log(`[worker] 标记中断任务 ${result.count} 个`);
}

/** 原子领取：updateMany 条件更新，抢不到即跳过下一个候选 */
async function claimNextJob(): Promise<JobLease | null> {
  const now = new Date();
  const candidates = await db.generationJob.findMany({
    where: {
      status: 'queued',
      OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });

  for (const job of candidates) {
    const claimed = await db.generationJob.updateMany({
      where: {
        id: job.id,
        status: 'queued',
        OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
      },
      data: {
        status: 'running',
        leasedBy: WORKER_ID,
        leasedUntil: new Date(Date.now() + env().JOB_LEASE_MS),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 1) return { jobId: job.id, workerId: WORKER_ID };
  }
  return null;
}

async function executeJob(lease: JobLease): Promise<void> {
  const job = await db.generationJob.findUnique({ where: { id: lease.jobId } });
  if (!job) return;
  try {
    if (job.type === 'lesson') await lessonTask(lease);
    else if (job.type === 'exercise_set') await practiceTask(lease);
    else await failJob(lease, 'INTERNAL', `未知任务类型：${job.type}`, false);
  } catch (err) {
    if (err instanceof JobLeaseLostError) return;
    const apiErr = toApiError(err);
    if (!(err instanceof ApiError)) console.error(`[worker] 任务 ${lease.jobId} 异常`, err);
    await failJob(lease, apiErr.code, apiErr.message, apiErr.retryable);
  }
}

async function tick(): Promise<void> {
  await markExpiredLeases();
  for (;;) {
    const jobId = await claimNextJob();
    if (!jobId) return;
    await executeJob(jobId);
  }
}

let ticking = false;

export function startWorker(): void {
  const interval = env().JOB_POLL_INTERVAL_MS;
  console.log(`[worker] ${WORKER_ID} 已启动，轮询间隔 ${interval}ms`);
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    tick()
      .catch((err) => console.error('[worker] 轮询失败', err))
      .finally(() => {
        ticking = false;
      });
  }, interval);
}
