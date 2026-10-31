import type { JobStatus, JobView } from '@luma/shared';
import { db } from '../lib/db';
import { notFound, notImplemented } from '../lib/errors';

/**
 * 生成任务状态（FR-11 / 设计文档 §8.3）。
 * 只读查询不重复触发模型；重试创建关联的新任务。
 */
export const jobService = {
  async get(userId: string, jobId: string): Promise<JobView> {
    const job = await db.generationJob.findFirst({
      where: { id: jobId, conversation: { userId } },
    });
    if (!job) throw notFound('任务');

    const error = job.error as { code?: string; message?: string; retryable?: boolean } | null;
    return {
      id: job.id,
      type: job.type,
      status: job.status as JobStatus,
      step: job.step,
      artifactId: job.resultArtifactId,
      error: error
        ? {
            code: error.code ?? 'INTERNAL',
            message: error.message ?? '生成失败',
            retryable: error.retryable ?? false,
          }
        : null,
    };
  },

  /** 失败可重试：创建关联新任务，复用幂等标识避免重复成果（FR-11） */
  async retry(_userId: string, _jobId: string) {
    throw notImplemented('任务重试');
  },
};
