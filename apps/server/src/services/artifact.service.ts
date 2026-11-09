import { db } from '../lib/db';
import { invalidFormat, notFound } from '../lib/errors';
import { Diagram } from '@luma/shared';
import { presentDiagram } from '../lib/teaching-graphic';

/**
 * 成果材料读取（FR-05 / FR-06 / 设计文档 §8.2）。
 * 讲义直接返回内容；题组作答阶段隐藏参考答案，提交进入自评后投影答案侧。
 */
export const artifactService = {
  async get(userId: string, artifactId: string) {
    const artifact = await db.artifact.findFirst({
      where: { id: artifactId, conversation: { userId } },
      include: { exercises: { orderBy: { order: 'asc' } }, subjectRevision: true },
    });
    if (!artifact) throw notFound('学习材料');

    if (artifact.type === 'lesson') {
      const rawLesson = (artifact.content as { lesson?: { title: string; sections: Array<{ id: string; heading: string; body: string }>; diagrams?: Array<{ sectionId: string; content: unknown }> } }).lesson;
      if (!rawLesson) throw invalidFormat('讲义内容不完整');
      const diagrams = rawLesson.diagrams ?? [];
      const sections = await Promise.all(rawLesson.sections.map(async (section) => ({
        ...section,
        diagram: await (async () => {
          const item = diagrams.find((item) => item.sectionId === section.id);
          return item ? presentDiagram(Diagram.parse(item.content)) : undefined;
        })(),
      })));
      return {
        id: artifact.id,
        type: artifact.type,
        version: artifact.version,
        publishStatus: artifact.publishStatus,
        subjectRevisionId: artifact.subjectRevisionId,
        conversationId: artifact.conversationId,
        subjectVersion: artifact.subjectRevision.version,
        subjectId: artifact.subjectRevision.subjectId,
        subject: {
          text: (artifact.subjectRevision.content as { text?: string }).text ?? '',
          tags: artifact.subjectRevision.tags,
          confirmed: Boolean(artifact.subjectRevision.confirmedAt),
        },
        content: { lesson: { title: rawLesson.title, sections } },
        jobId: artifact.jobId,
        createdAt: artifact.createdAt,
      };
    }

    if (artifact.type === 'exercise_set') {
      const activeAttempt = await db.practiceAttempt.findFirst({
        where: { artifactId: artifact.id, userId },
        orderBy: { createdAt: 'desc' },
      });
      const includeAnswers =
        Boolean(activeAttempt) && ['review', 'summary'].includes(activeAttempt!.stage);
      return {
        id: artifact.id,
        type: artifact.type,
        version: artifact.version,
        publishStatus: artifact.publishStatus,
        subjectRevisionId: artifact.subjectRevisionId,
        subjectId: artifact.subjectRevision.subjectId,
        conversationId: artifact.conversationId,
        subjectVersion: artifact.subjectRevision.version,
        answersHidden: !includeAnswers,
        attemptId: activeAttempt?.id ?? null,
        exercises: artifact.exercises.map((ex) => ({
          id: ex.id,
          order: ex.order,
          stem: ex.stem,
          topic: ex.topic,
          difficulty: ex.difficulty,
          purpose: ex.purpose,
          ...(includeAnswers && (activeAttempt!.exerciseIds as string[]).includes(ex.id) ? { answer: ex.answer, analysis: ex.analysis } : {}),
        })),
        createdAt: artifact.createdAt,
      };
    }

    throw invalidFormat(`未知材料类型：${artifact.type}`);
  },
};
