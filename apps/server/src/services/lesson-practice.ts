import type { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { notFound } from '../lib/errors';

export interface PracticeSource {
  artifactId: string; artifactVersion: number; subjectRevisionId: string;
  scope: 'whole_lesson'; count: number; difficulty: string | null;
}

/** The source and recipe are frozen in the job; never match another lesson by topic text. */
export async function practiceSource(client: Prisma.TransactionClient, userId: string, artifactId: string, version: number,
  count = 2, difficulty: string | null = 'basic'): Promise<PracticeSource> {
  const lesson = await client.artifact.findFirst({ where: { id: artifactId, version, type: 'lesson', publishStatus: 'published', conversation: { userId } } });
  if (!lesson) throw notFound('对应版本的图文讲解');
  return { artifactId: lesson.id, artifactVersion: lesson.version, subjectRevisionId: lesson.subjectRevisionId, scope: 'whole_lesson', count, difficulty };
}

export function matchesPracticeSource(payload: unknown, source: PracticeSource): boolean {
  const value = payload as { practiceSource?: PracticeSource; count?: number; difficulty?: string; evidence?: { focus?: { artifactId?: string; artifactVersion?: number; sectionId?: string; attemptId?: string; exerciseId?: string } } } | null;
  if (value?.practiceSource) return (['artifactId', 'artifactVersion', 'subjectRevisionId', 'scope', 'count', 'difficulty'] as const)
    .every((key) => value.practiceSource![key] === source[key]);
  // Older jobs already carry an evidence focus. Only exact full-lesson references are trustworthy.
  const focus = value?.evidence?.focus;
  return Boolean(focus && focus.artifactId === source.artifactId && focus.artifactVersion === source.artifactVersion &&
    !focus.sectionId && !focus.attemptId && !focus.exerciseId && (value?.count ?? 2) === source.count && (value?.difficulty ?? 'basic') === source.difficulty);
}

/** Caller holds the conversation lock when this lookup precedes job creation. GET remains read-only. */
export async function findLessonPractice(client: Prisma.TransactionClient, conversationId: string, source: PracticeSource) {
  const jobs = await client.generationJob.findMany({ where: { conversationId, subjectRevisionId: source.subjectRevisionId, type: 'exercise_set',
    status: { in: ['queued', 'running', 'succeeded', 'failed'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  for (const job of jobs) {
    if (!matchesPracticeSource(job.payload, source)) continue;
    if (job.status === 'succeeded') {
      const artifact = job.resultArtifactId ? await client.artifact.findFirst({ where: { id: job.resultArtifactId, conversationId,
        subjectRevisionId: source.subjectRevisionId, type: 'exercise_set', publishStatus: 'published' } }) : null;
      if (!artifact) continue;
      return { job, artifact };
    }
    return { job, artifact: null };
  }
  return null;
}

/** The same lock is used by generation, retry and publish; source lookup and creation are indivisible. */
export async function ensureLessonPractice(client: Prisma.TransactionClient, conversationId: string, source: PracticeSource,
  create: () => Promise<Prisma.GenerationJobGetPayload<{}>>) {
  await client.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
  return await findLessonPractice(client, conversationId, source) ?? { job: await create(), artifact: null };
}

export async function getLessonPractice(userId: string, artifactId: string, version: number) {
  const source = await practiceSource(db, userId, artifactId, version);
  const lesson = await db.artifact.findUniqueOrThrow({ where: { id: artifactId } });
  const found = await findLessonPractice(db, lesson.conversationId, source);
  if (!found) return { status: 'none' as const };
  return { status: found.job.status as 'queued' | 'running' | 'succeeded' | 'failed', jobId: found.job.id, artifactId: found.artifact?.id ?? null };
}
