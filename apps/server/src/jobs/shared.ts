import type { ArtifactType, Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { env } from '../lib/env';

export interface JobLease {
  jobId: string;
  workerId: string;
}

/** 租约丢失、取消或已失效后，不再允许旧执行者写状态。 */
export class JobLeaseLostError extends Error {
  constructor() { super('任务已停止或租约已失效'); }
}

function ownedRunning(lease: JobLease): Prisma.GenerationJobWhereInput {
  return {
    id: lease.jobId,
    status: 'running',
    leasedBy: lease.workerId,
    leasedUntil: { gt: new Date() },
  };
}

export async function touchJob(lease: JobLease, step?: string): Promise<void> {
  const result = await db.generationJob.updateMany({
    where: ownedRunning(lease),
    data: {
      leasedUntil: new Date(Date.now() + env().JOB_LEASE_MS),
      ...(step ? { step } : {}),
    },
  });
  if (result.count !== 1) throw new JobLeaseLostError();
}

export async function failJob(
  lease: JobLease,
  code: string,
  message: string,
  retryable: boolean,
): Promise<void> {
  await db.generationJob.updateMany({
    where: ownedRunning(lease),
    data: { status: 'failed', error: { code, message, retryable }, leasedUntil: null, leasedBy: null },
  });
}

/** 发布必须与终态更新处于同一事务；所有材料任务共用此边界。 */
export async function publishArtifact(
  lease: JobLease,
  type: ArtifactType,
  content: Prisma.InputJsonValue,
  exercises: Array<{
    order: number; stem: string; topic: string; difficulty: string;
    purpose: string; answer: string; analysis: string;
  }> = [],
): Promise<string | null> {
  return db.$transaction(async (tx) => {
    const job = await tx.generationJob.findUniqueOrThrow({ where: { id: lease.jobId } });
    // 同一会话的发布串行化；题目新版本的外键插入也与此父行锁互斥。
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${job.conversationId} FOR UPDATE`;
    const claimed = await tx.generationJob.updateMany({
      where: ownedRunning(lease),
      data: { leasedUntil: new Date(Date.now() + env().JOB_LEASE_MS) },
    });
    if (claimed.count !== 1) throw new JobLeaseLostError();

    const current = await tx.subjectRevision.findFirst({
      where: { subjectId: job.subjectId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!job.subjectRevisionId || current?.id !== job.subjectRevisionId) {
      await tx.generationJob.update({
        where: { id: job.id },
        data: { status: 'superseded', leasedUntil: null, leasedBy: null, step: null },
      });
      return null;
    }
    if (job.type !== type) throw new Error('任务与成果类型不一致');

    const last = await tx.artifact.findFirst({
      where: { subjectRevisionId: job.subjectRevisionId, type },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const artifact = await tx.artifact.create({
      data: {
        conversationId: job.conversationId,
        subjectRevisionId: job.subjectRevisionId,
        type,
        version: (last?.version ?? 0) + 1,
        publishStatus: 'published',
        content,
        jobId: job.id,
        ...(exercises.length ? { exercises: { create: exercises } } : {}),
      },
    });
    const completed = await tx.generationJob.updateMany({
      where: ownedRunning(lease),
      data: { status: 'succeeded', resultArtifactId: artifact.id, step: null, leasedUntil: null, leasedBy: null },
    });
    if (completed.count !== 1) throw new JobLeaseLostError();
    return artifact.id;
  });
}
