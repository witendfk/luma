import { Prisma } from '@prisma/client';
import { db } from '../lib/db';

/** 本轮执行已被取消、替换、超时或丢失租约；旧执行者不得再提交副作用。 */
export class RunStoppedError extends Error {}

// 仅作为同进程快速取消；跨进程取消仍由数据库状态和心跳保证。
export const activeControllers = new Map<string, AbortController>();

export async function withActiveRun<T>(
  runId: string,
  owner: string,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const run = await tx.agentRun.findUniqueOrThrow({ where: { id: runId } });
    // 与新输入、取消、任务重试共用会话锁；状态核验和业务写入不可分离。
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${run.conversationId} FOR UPDATE`;
    const claimed = await tx.agentRun.updateMany({
      where: {
        id: runId, status: 'running', leaseBy: owner, leaseUntil: { gt: new Date() },
        OR: [{ deadlineAt: null }, { deadlineAt: { gt: new Date() } }],
      },
      data: { leaseBy: owner },
    });
    if (claimed.count !== 1) throw new RunStoppedError('本轮执行已停止');
    const latest = await tx.subjectRevision.findFirst({
      where: { subjectId: run.subjectId }, orderBy: { version: 'desc' }, select: { id: true },
    });
    if (run.subjectRevisionId !== (latest?.id ?? null)) throw new RunStoppedError('学习对象已更新');
    return mutate(tx);
  });
}
