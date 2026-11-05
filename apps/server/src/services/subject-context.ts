import type { Prisma } from '@prisma/client';
import { conversationBusy, notFound, revisionConflict } from '../lib/errors';

/** Caller holds the conversation lock for mutations. Never resolve by global latest revision. */
export async function resolveSubject(tx: Prisma.TransactionClient, conversationId: string, subjectId?: string) {
  const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const id = subjectId ?? conversation.activeSubjectId;
  const subject = id ? await tx.learningSubject.findFirst({ where: { id, conversationId } }) : null;
  if (!subject) throw notFound('学习对象');
  return subject;
}

export async function latestRevision(tx: Prisma.TransactionClient, subjectId: string) {
  return tx.subjectRevision.findFirst({ where: { subjectId }, orderBy: { version: 'desc' } });
}

export async function assertIdle(tx: Prisma.TransactionClient, conversationId: string) {
  const active = await tx.agentRun.findFirst({ where: { conversationId, status: { in: ['running', 'waiting_job'] } } });
  if (active) throw conversationBusy();
  const job = await tx.generationJob.findFirst({ where: { conversationId, status: { in: ['queued', 'running'] } } });
  if (job) throw conversationBusy();
}

export async function requireRevision(tx: Prisma.TransactionClient, subjectId: string, expected?: number) {
  const revision = await latestRevision(tx, subjectId);
  if (!revision || (expected !== undefined && revision.version !== expected)) throw revisionConflict();
  return revision;
}
