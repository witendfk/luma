import { db } from '../lib/db';
import { drive } from '../agent/loop';

/**
 * 恢复调度（设计文档 §4.13）：
 * worker 保存任务终态后扫描待恢复运行，条件领取执行权后调用同一 drive。
 * 扫描可以重复，推进必须去重（条件更新领取）。
 */

export async function resumeRunsForJob(jobId: string): Promise<void> {
  const job = await db.generationJob.findUnique({ where: { id: jobId }, select: { runId: true } });
  if (!job?.runId) return;
  const run = await db.agentRun.findFirst({
    where: { id: job.runId, status: 'waiting_job', waitingJobIds: { has: jobId } },
    select: { id: true, waitingJobIds: true },
  });
  if (!run) return;
  await resumeIfReady(run.id, run.waitingJobIds);
}

/** 兜底扫描：等待入库前任务已完成的运行也能被发现（§4.13）；进程重启后同样适用 */
export async function scanWaitingRuns(): Promise<void> {
  const runs = await db.agentRun.findMany({
    where: { status: 'waiting_job' },
    select: { id: true, waitingJobIds: true },
  });
  for (const run of runs) {
    await resumeIfReady(run.id, run.waitingJobIds);
  }
}

async function resumeIfReady(runId: string, waitingJobIds: string[]): Promise<void> {
  if (waitingJobIds.length > 0) {
    const jobs = await db.generationJob.findMany({
      where: { id: { in: waitingJobIds } },
      select: { status: true },
    });
    if (jobs.length < waitingJobIds.length) return; // 有任务记录丢失：等待显式重试入口
    if (jobs.some((j) => j.status === 'queued' || j.status === 'running')) return;
  }
  await claimAndDrive(runId);
}

async function claimAndDrive(runId: string): Promise<void> {
  await drive(runId).catch((err) => console.error(`[scheduler] 恢复运行 ${runId} 失败`, err));
}

/** 竞赛版中断恢复：过期执行不猜测续跑位置，明确失败并允许学生重试。 */
export async function failExpiredRuns(): Promise<void> {
  const now = new Date();
  await db.agentRun.updateMany({
    where: { OR: [
      { status: 'running', leaseUntil: { lt: now } },
      { status: 'running', leaseUntil: null, startedAt: { lt: new Date(Date.now() - 120_000) } },
      { status: { in: ['running', 'waiting_job'] }, deadlineAt: { lt: now } },
    ] },
    data: { status: 'failed', finishedAt: now, leaseBy: null, leaseUntil: null,
      error: { code: 'RUN_INTERRUPTED', message: '运行超时或执行中断，请重试', retryable: true } },
  });
}
