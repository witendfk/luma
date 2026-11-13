import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { invalidFormat, notFound, revisionConflict } from '../lib/errors';

/**
 * 练习闭环（FR-06/07/08 / 设计文档 §3.3）：真实实现。
 * intro→doing 由 start 完成；submit 进入 review 并投影参考解析；complete 校验自评齐全进入 summary。
 * 普通开始复用最近轮次；显式重做创建空白轮次，完成轮次只读。
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
    conversationId: attempt.artifact.conversationId,
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
    const rows = await db.practiceAttempt.findMany({ where: { userId, artifactId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, artifactId: true, stage: true, currentExerciseId: true, createdAt: true, submittedAt: true, completedAt: true, exerciseIds: true } });
    return rows.map(({ exerciseIds, ...row }) => ({ ...row, exerciseCount: (exerciseIds as string[]).length }));
  },
  /** 来源+请求号持久化：响应丢失后重试返回同一轮；不同请求不得从旧轮并发重建。 */
  async redo(userId: string, sourceId: string, input: { mode: 'all' | 'needs_practice'; requestId: string }) {
    return db.$transaction(async (tx) => {
      const source = await loadAttempt(userId, sourceId, tx);
      await tx.$queryRaw`SELECT id FROM "Artifact" WHERE id = ${source.artifactId} FOR UPDATE`;
      const prior = await tx.practiceAttempt.findUnique({ where: { userId_redoRequestId: { userId, redoRequestId: input.requestId } } });
      if (prior) {
        if (prior.redoOfAttemptId !== sourceId || prior.redoMode !== input.mode) throw revisionConflict('重做请求与原操作不一致，请重新打开练习');
        const loaded = await loadAttempt(userId, prior.id, tx);
        return buildView(loaded, ['review', 'summary'].includes(loaded.stage));
      }
      const latest = await tx.practiceAttempt.findFirst({ where: { userId, artifactId: source.artifactId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      if (source.stage !== 'summary' || latest?.id !== sourceId) throw revisionConflict('请先完成当前轮次；如已在其他设备重做，请重新打开练习');
      if (source.artifact.publishStatus !== 'published') throw invalidFormat('这份练习尚未发布');
      const selectedIds = new Set(source.exerciseIds as string[]);
      const needs = new Set(source.answers.filter((a) => a.selfEval === 'partial' || a.selfEval === 'stuck').map((a) => a.exerciseId));
      const selected = source.artifact.exercises.filter((ex) => input.mode === 'all' || (selectedIds.has(ex.id) && needs.has(ex.id)));
      if (!selected.length) throw invalidFormat('本轮没有需要巩固的题目，可选择全部重做');
      const created = await tx.practiceAttempt.create({ data: { artifactId: source.artifactId, userId,
        exerciseIds: selected.map((ex) => ex.id), stage: 'doing', currentExerciseId: selected[0]!.id,
        redoOfAttemptId: sourceId, redoMode: input.mode, redoRequestId: input.requestId } });
      return buildView(await loadAttempt(userId, created.id, tx), false);
    });
  },
  /** 普通开始是ensure操作：并发点击、重进与网络重试均复用最近轮次。 */
  async start(userId: string, input: { artifactId: string; exerciseIds?: string[] }) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Artifact" WHERE id = ${input.artifactId} FOR UPDATE`;
      const artifact = await tx.artifact.findFirst({ where: { id: input.artifactId, conversation: { userId }, type: 'exercise_set', publishStatus: 'published' },
        include: { exercises: { orderBy: { order: 'asc' } } } });
      if (!artifact) throw notFound('已发布题组');
      const selected = input.exerciseIds ? artifact.exercises.filter((ex) => input.exerciseIds!.includes(ex.id)) : artifact.exercises;
      if (!selected.length || (input.exerciseIds && (new Set(input.exerciseIds).size !== input.exerciseIds.length || selected.length !== input.exerciseIds.length))) throw invalidFormat('练习题目范围无效');
      const latest = await tx.practiceAttempt.findFirst({ where: { artifactId: artifact.id, userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      if (latest && input.exerciseIds && JSON.stringify(latest.exerciseIds) !== JSON.stringify(selected.map((e) => e.id))) throw invalidFormat('继续练习不能修改题目范围');
      const attempt = latest ?? await tx.practiceAttempt.create({ data: { artifactId: artifact.id, userId,
        exerciseIds: selected.map((ex) => ex.id), stage: 'doing', currentExerciseId: selected[0]!.id } });
      const loaded = await loadAttempt(userId, attempt.id, tx);
      return buildView(loaded, ['review', 'summary'].includes(loaded.stage));
    });
  },

  async position(userId: string, attemptId: string, exerciseId: string) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PracticeAttempt" WHERE id = ${attemptId} FOR UPDATE`;
      const attempt = await loadAttempt(userId, attemptId, tx);
      if (!(attempt.exerciseIds as string[]).includes(exerciseId)) throw invalidFormat('该题不在本轮练习中');
      // 阅读历史不改变已经完成的作答轮次。
      if (attempt.stage !== 'summary') await tx.practiceAttempt.update({ where: { id: attemptId }, data: { currentExerciseId: exerciseId } });
      return { currentExerciseId: exerciseId };
    });
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
      if (input.photoIds !== undefined) {
        if (input.photoIds.length > 3 || new Set(input.photoIds).size !== input.photoIds.length) throw invalidFormat('每题最多3张不同的作答照片');
        const photos = await tx.attachment.findMany({ where: { id: { in: input.photoIds }, userId, status: 'ready', purpose: 'answer_photo' } });
        if (photos.length !== input.photoIds.length || photos.some((photo) => {
          const scope = photo.scope as { conversationId?: string; subjectRevisionId?: string; attemptId?: string; exerciseId?: string } | null;
          return scope?.conversationId !== attempt.artifact.conversationId || scope?.subjectRevisionId !== attempt.artifact.subjectRevisionId
            || scope?.attemptId !== attemptId || scope?.exerciseId !== exerciseId;
        })) throw invalidFormat('照片未上传完成或不属于本轮当前题目');
      }

      const existing = await tx.practiceAnswer.findUnique({
        where: { attemptId_exerciseId: { attemptId, exerciseId } },
      });
      if (existing && input.draftVersion <= existing.draftVersion) {
        // Response loss may retry the exact same saved version. Never accept a different stale payload.
        const equal = input.draftVersion === existing.draftVersion &&
          Object.entries(input).every(([key, value]) => key === 'draftVersion' || value === undefined ||
            JSON.stringify(key === 'solutionViewedAt' ? existing.solutionViewedAt?.toISOString() : (existing as unknown as Record<string, unknown>)[key]) === JSON.stringify(value));
        if (equal) return { saved: true, draftVersion: existing.draftVersion };
        throw revisionConflict('草稿已在其他设备更新，本机内容已保留，请重新打开核对');
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
      if (['review', 'summary'].includes(attempt.stage)) return buildView(attempt, true);
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
      if (!['review', 'summary'].includes(attempt.stage)) throw invalidFormat('请先提交作答再完成自评');

      const selectedIds = attempt.exerciseIds as string[];
      const answers = attempt.answers;
      const missing = selectedIds.filter((id) => {
        const a = answers.find((x) => x.exerciseId === id);
        return !a || !a.selfEval;
      });
      if (missing.length > 0) {
        throw invalidFormat(`还有 ${missing.length} 道题未完成自评`);
      }

      if (attempt.stage !== 'summary') await tx.practiceAttempt.update({
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
