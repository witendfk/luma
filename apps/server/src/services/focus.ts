import type { Prisma } from '@prisma/client';
import { invalidFormat, notFound } from '../lib/errors';

export interface LearningFocus { artifactId?: string; sectionId?: string; attemptId?: string; exerciseId?: string }

/** IDs supplied by a client/model must belong to this exact object revision. */
export async function validateFocus(tx: Prisma.TransactionClient, userId: string, conversationId: string, revisionId: string, focus: LearningFocus) {
  if ((focus.sectionId || focus.attemptId || focus.exerciseId) && !focus.artifactId) throw invalidFormat('请提供所属学习材料');
  if (!focus.artifactId) return;
  const artifact = await tx.artifact.findFirst({ where: { id: focus.artifactId, conversationId, subjectRevisionId: revisionId, publishStatus: 'published' } });
  if (!artifact) throw notFound('当前版本的学习材料');
  if (focus.sectionId) {
    const lesson = (artifact.content as { lesson?: { sections?: Array<{ id: string }> } }).lesson;
    if (artifact.type !== 'lesson' || !lesson?.sections?.some((row) => row.id === focus.sectionId)) throw invalidFormat('讲义章节不存在');
  }
  if (focus.attemptId) {
    const attempt = await tx.practiceAttempt.findFirst({ where: { id: focus.attemptId, userId, artifactId: artifact.id } });
    if (!attempt) throw notFound('所属练习轮次');
    if (focus.exerciseId && !(attempt.exerciseIds as string[]).includes(focus.exerciseId)) throw invalidFormat('该题不在本轮练习中');
  } else if (focus.exerciseId) throw invalidFormat('请提供所属练习轮次');
}
