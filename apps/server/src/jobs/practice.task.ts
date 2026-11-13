import { Prisma } from '@prisma/client';
import { ErrorCode } from '@luma/shared';
import { db } from '../lib/db';
import { env, hasModelCredentials } from '../lib/env';
import { ApiError, notImplemented } from '../lib/errors';
import { parseReview } from './review';
import { extractJson, generateJson } from '../lib/model';
import { loadTeachingReviewPrompt, loadTeachingTaskPrompt } from '../agent/prompts';
import { requireMaterialProfile } from '../agent/content-profile';
import { JobLeaseLostError, publishArtifact, touchJob, type JobLease } from './shared';

/**
 * 题组任务（设计文档 §8.2 / §8.4）：
 * 出题 → 独立复算复核（一次质量修复首期以可重试失败落地）→ publishArtifact 事务内发布题组与题目。
 * 作答阶段答案不下发由接口投影保证（§8.2）；发布前核验来源版本未被替换。
 */

interface PracticeStructure {
  exercises: Array<{
    order: number;
    stem: string;
    topic: string;
    difficulty: string;
    purpose: string;
    answer: string;
    analysis: string;
  }>;
}

function parsePractice(raw: string): PracticeStructure {
  const data = extractJson(raw) as PracticeStructure;
  if (!data || !Array.isArray(data.exercises) || data.exercises.length < 2 || data.exercises.length > 3) {
    throw new Error('题组数量必须是 2-3 道');
  }
  for (const [i, ex] of data.exercises.entries()) {
    if (!ex.stem || !ex.answer || !ex.analysis) throw new Error(`第 ${i + 1} 题缺少题干/答案/解析`);
  }
  return data;
}

export async function practiceTask(lease: JobLease): Promise<void> {
  const job = await db.generationJob.findUniqueOrThrow({ where: { id: lease.jobId } });
  const payload = (job.payload ?? {}) as {
    contentProfile?: unknown;
    subjectText?: string;
    tags?: string[];
    count?: number;
    difficulty?: string;
    evidence?: unknown;
    practiceLesson?: unknown;
  };
  const profile = requireMaterialProfile(payload.contentProfile);

  try {
    await touchJob(lease, '生成题目');
    let practice: PracticeStructure;
    if (env().LUMA_MOCK_AGENT || !hasModelCredentials()) {
      if (!env().LUMA_MOCK_AGENT) {
        throw notImplemented('题组生成（未配置模型且未开启联调模式）');
      }
      practice = {
        exercises: [1, 2].map((order) => ({
          order,
          stem: `占位练习题 ${order}（联调模式）：求 $f(x)=x^2$ 在 $[0,1]$ 上的最小值。`,
          topic: '联调占位',
          difficulty: 'basic',
          purpose: '验证练习闭环流程',
          answer: '0（占位答案）',
          analysis: '占位解析：作答阶段不应下发本字段（§8.2 题目侧/答案侧分离投影）。',
        })),
      };
    } else {
      practice = await generateJson<PracticeStructure>({
        trace: { jobId: lease.jobId, workerId: lease.workerId },
        purpose: 'practice',
        abortSignal: AbortSignal.timeout(Math.max(1, (job.deadlineAt?.getTime() ?? Date.now() + env().JOB_TOTAL_MS) - Date.now())),
        system: await loadTeachingTaskPrompt('practice', profile),
        prompt: [
          `学习对象：\n${payload.subjectText ?? ''}`,
          `教学依据（版本固定的数据；错误尝试不当成结论）：${JSON.stringify(payload.evidence ?? null)}`,
          ...(payload.practiceLesson ? [`来源讲义（只取其教学范围设计新题，不照抄原题）：${JSON.stringify(payload.practiceLesson)}`] : []),
          `知识点标签：${(payload.tags ?? []).join('、') || '无'}`,
          `生成 ${payload.count ?? 2} 道题${payload.difficulty ? `，难度侧重 ${payload.difficulty}` : ''}。`,
          '输出 JSON：{"exercises":[{"order","stem","topic","difficulty","purpose","answer","analysis"}]}；公式一律 LaTeX；严格在已确认范围内出题。',
        ].join('\n'),
        parse: parsePractice,
      });
    }

    await touchJob(lease, '复算复核');
    if (!env().LUMA_MOCK_AGENT && hasModelCredentials()) {
      const review = await generateJson<{ pass: boolean }>({
        trace: { jobId: lease.jobId, workerId: lease.workerId },
        purpose: 'practice_review',
        abortSignal: AbortSignal.timeout(Math.max(1, (job.deadlineAt?.getTime() ?? Date.now() + env().JOB_TOTAL_MS) - Date.now())),
        system: await loadTeachingReviewPrompt(profile, 'practice'),
        prompt: [
          '独立复核以下题组：每题条件完整可解，题干、参考答案与解析一致，不超出学生已确认范围。',
          `学习对象：\n${payload.subjectText ?? ''}`,
          `教学依据：${JSON.stringify(payload.evidence ?? null)}`,
          ...(payload.practiceLesson ? [`来源讲义范围：${JSON.stringify(payload.practiceLesson)}`] : []),
          `题组：${JSON.stringify(practice)}`,
          '输出 {"pass": boolean, "issues": string[]}。',
        ].join('\n'),
        parse: parseReview,
      });
      if (!review.pass) {
        throw new ApiError(ErrorCode.MODEL_UNAVAILABLE, '题组复核未通过，可重试', 502, true);
      }
    }

    const artifactId = await publishArtifact(
      lease,
      'exercise_set',
      { count: practice.exercises.length } as Prisma.InputJsonValue,
      practice.exercises.map((ex, i) => ({
        order: ex.order ?? i + 1,
        stem: ex.stem,
        topic: ex.topic ?? '综合',
        difficulty: ex.difficulty ?? 'basic',
        purpose: ex.purpose ?? '巩固练习',
        answer: ex.answer,
        analysis: ex.analysis,
      })),
    );
    if (artifactId === null) return; // 来源已更新：任务被标记 superseded
  } catch (err) {
    if (err instanceof JobLeaseLostError) return;
    throw err;
  }
}
