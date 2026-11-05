import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { invalidFormat, notFound, revisionConflict } from '../lib/errors';

/**
 * 练习闭环（FR-06/07/08 / 设计文档 §3.3）：真实实现。
 * intro→doing 由 start 完成；submit 进入 review 并投影参考解析；complete 校验自评齐全进入 summary。
 * 重做创建新轮次（沿用原题或仅需巩固题），历史轮次只读。
 */

type LoadedAttempt = Prisma.PracticeAttemptGetPayload<{
  include: { artifact: { include: { exercises: true; subjectRevision: true } }; answers: true };
}>;

async function loadAttempt(userId: string, attemptId: string, client: Prisma.TransactionClient = db): Promise<LoadedAttempt> {
  const attempt = await client.practiceAttempt.findFirst({
    where: { id: attemptId, userId },
    include: { artifact: { include: { exercises: { orderBy: { order: 'asc' } }, subjectRevision: true } }, answers: true },
  });
  if (!attempt) throw notFound('练习轮次');
  return attempt;
}

function buildView(attempt: LoadedAttempt, includeAnswers: boolean) {
  const answerMap = new Map(attempt.answers.map((a) => [a.exerciseId, a]));
  const selectedIds = attempt.exerciseIds as string[];
  const exercises = attempt.artifact.exercises
    .filter((ex) => selectedIds.includes(ex.id))
    .map((ex) => {
      const answer = answerMap.get(ex.id);
      return {
        id: ex.id,
        order: ex.order,
        stem: ex.stem,
        topic: ex.topic,
        difficulty: ex.difficulty,
        purpose: ex.purpose,
        ...(includeAnswers ? { answer: ex.answer, analysis: ex.analysis } : {}),
        myAnswer: answer
          ? {
            textDraft: answer.textDraft,
            photoIds: answer.photoIds,
            markedUnknown: answer.markedUnknown,
            hintsUsed: answer.hintsUsed,
            solutionViewedAt: answer.solutionViewedAt,
            selfEval: answer.selfEval,
            draftVersion: answer.draftVersion,
          }
          : null,
      };
    });
  return {
    id: attempt.id,
    artifactId: attempt.artifactId,
    subjectId: attempt.artifact.subjectRevision.subjectId,
    subjectRevisionId: attempt.artifact.subjectRevisionId,
    stage: attempt.stage,
    currentExerciseId: attempt.currentExerciseId,
    submittedAt: attempt.submittedAt,
    completedAt: attempt.completedAt,
    answersHidden: !includeAnswers,
    exercises,
  };
}

export const practiceService = {
  async history(userId: string, artifactId: string) {
    const artifact = await db.artifact.findFirst({ where: { id: artifactId, type: 'exercise_set', conversation: { userId } } });
    if (!artifact) throw notFound('题组');
    return db.practiceAttempt.findMany({ where: { userId, artifactId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, artifactId: true, stage: true, currentExerciseId: true, createdAt: true, submittedAt: true, completedAt: true } });
  },
  /** 开始或重做（FR-07：重做创建新轮次，沿用原题或所选需巩固题） */
  async start(userId: string, input: { artifactId: string; exerciseIds?: string[] }) {
    const artifact = await db.artifact.findFirst({
      where: { id: input.artifactId, conversation: { userId }, type: 'exercise_set' },
      include: { exercises: { orderBy: { order: 'asc' } } },
    });
    if (!artifact) throw notFound('题组');
    if (artifact.publishStatus !== 'published') throw invalidFormat('题组尚未发布，不能开始作答');

    const selected = input.exerciseIds
      ? artifact.exercises.filter((ex) => input.exerciseIds!.includes(ex.id))
      : artifact.exercises;
    if (selected.length === 0) throw invalidFormat('没有可作答的题目');

    const attempt = await db.practiceAttempt.create({
      data: {
        artifactId: artifact.id,
        userId,
        exerciseIds: selected.map((ex) => ex.id),
        stage: 'doing',
        currentExerciseId: selected[0]?.id ?? null,
      },
    });
    const loaded = await loadAttempt(userId, attempt.id);
    return buildView(loaded, false);
  },

  async get(userId: string, attemptId: string) {
    const attempt = await loadAttempt(userId, attemptId);
    const includeAnswers = ['review', 'summary'].includes(attempt.stage);
    return buildView(attempt, includeAnswers);
  },

  /**
   * 草稿/照片/暂不会/提示/自评保存（设计文档 §10）：
   * (轮次, 题目) 定位；draftVersion 递增，旧草稿覆盖新草稿被拒绝。
   */
  async saveAnswer(
    userId: string,
    attemptId: string,
    exerciseId: string,
    input: {
      textDraft?: string;
      photoIds?: string[];
      markedUnknown?: boolean;
      hintsUsed?: number;
      solutionViewedAt?: string;
      selfEval?: 'independent' | 'partial' | 'stuck';
      draftVersion: number;
    },
  ) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PracticeAttempt" WHERE id = ${attemptId} FOR UPDATE`;
      const attempt = await loadAttempt(userId, attemptId, tx);
      if (attempt.stage === 'summary') throw invalidFormat('已完成轮次只读，请创建新轮次重做');
      if (attempt.stage !== 'doing' && [input.textDraft, input.photoIds, input.markedUnknown].some((v) => v !== undefined)) {
        throw invalidFormat('提交后不能再修改作答草稿');
      }
      if (input.selfEval !== undefined && attempt.stage !== 'review') throw invalidFormat('提交后才能保存自评');
      const selectedIds = attempt.exerciseIds as string[];
      if (!selectedIds.includes(exerciseId)) throw invalidFormat('该题不在本轮练习范围内');

      const existing = await tx.practiceAnswer.findUnique({
        where: { attemptId_exerciseId: { attemptId, exerciseId } },
      });
      if (existing && input.draftVersion <= existing.draftVersion) {
        throw revisionConflict('草稿已在其他设备更新，请刷新后重试');
      }

      const data = {
        ...(input.textDraft !== undefined ? { textDraft: input.textDraft } : {}),
        ...(input.photoIds !== undefined ? { photoIds: input.photoIds } : {}),
        ...(input.markedUnknown !== undefined ? { markedUnknown: input.markedUnknown } : {}),
        ...(input.hintsUsed !== undefined ? { hintsUsed: input.hintsUsed } : {}),
        ...(input.solutionViewedAt !== undefined ? { solutionViewedAt: new Date(input.solutionViewedAt) } : {}),
        ...(input.selfEval !== undefined ? { selfEval: input.selfEval } : {}),
        draftVersion: input.draftVersion,
      };

      const saved = await tx.practiceAnswer.upsert({
        where: { attemptId_exerciseId: { attemptId, exerciseId } },
        update: data,
        create: { attemptId, exerciseId, ...data },
      });

      if (attempt.stage === 'doing') {
        await tx.practiceAttempt.update({
          where: { id: attemptId },
          data: { currentExerciseId: exerciseId },
        });
      }
      return { saved: true, draftVersion: saved.draftVersion };
    });
  },

  /** 提交进入自评（FR-08：允许按未完成提交，前端负责空题提醒） */
  async submit(userId: string, attemptId: string) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PracticeAttempt" WHERE id = ${attemptId} FOR UPDATE`;
      const attempt = await loadAttempt(userId, attemptId, tx);
      if (attempt.stage !== 'doing') throw invalidFormat('当前轮次不在作答阶段');
      await tx.practiceAttempt.update({
        where: { id: attemptId },
        data: { stage: 'review', submittedAt: new Date() },
      });
      const reloaded = await loadAttempt(userId, attemptId, tx);
      return buildView(reloaded, true);
    });
  },

  /** 自评齐全校验并完成本轮（FR-08：自评未完成时提示补齐） */
  async complete(userId: string, attemptId: string) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PracticeAttempt" WHERE id = ${attemptId} FOR UPDATE`;
      const attempt = await loadAttempt(userId, attemptId, tx);
      if (attempt.stage !== 'review') throw invalidFormat('请先提交作答再完成自评');

      const selectedIds = attempt.exerciseIds as string[];
      const answers = attempt.answers;
      const missing = selectedIds.filter((id) => {
        const a = answers.find((x) => x.exerciseId === id);
        return !a || !a.selfEval;
      });
      if (missing.length > 0) {
        throw invalidFormat(`还有 ${missing.length} 道题未完成自评`);
      }

      await tx.practiceAttempt.update({
        where: { id: attemptId },
        data: { stage: 'summary', completedAt: new Date() },
      });

      const summary = selectedIds.map((exerciseId) => {
        const a = answers.find((x) => x.exerciseId === exerciseId)!;
        return {
          exerciseId,
          selfEval: a.selfEval,
          hintsUsed: a.hintsUsed,
          solutionViewed: Boolean(a.solutionViewedAt),
          markedUnknown: a.markedUnknown,
        };
      });
      return {
        attemptId,
        summary,
        // FR-08：反馈中标明借助讲解完成的部分，提醒如实区分
        usedHelp: summary.some((s) => s.hintsUsed > 0 || s.solutionViewed),
      };
    });
  },
};
