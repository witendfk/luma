import { Prisma } from '@prisma/client';
import { ErrorCode } from '@luma/shared';
import { db } from '../lib/db';
import { env, hasModelCredentials } from '../lib/env';
import { ApiError, notImplemented } from '../lib/errors';
import { parseReview } from './review';
import { extractJson, generateJson } from '../lib/model';
import { loadPrompt } from '../agent/prompts';
import { JobLeaseLostError, publishArtifact, touchJob, type JobLease } from './shared';

/**
 * 图文讲义任务（设计文档 §8.1 / §8.4）：
 * 正文生成 → 保存可恢复草稿检查点 → 独立复核（首期以可重试失败落地，一次修复待接入）
 * → publishArtifact 事务内发布（含来源版本核验与并发串行化）。
 * 输入来自创建时固定的 payload，worker 不从可变状态重建（§9.1）。
 */

interface LessonStructure {
  title: string;
  sections: Array<{ id: string; heading: string; body: string }>;
  illustrations?: Array<{ sectionId: string; caption: string; description: string }>;
}

function parseLesson(raw: string): LessonStructure {
  const data = extractJson(raw) as LessonStructure;
  if (!data || !data.title || !Array.isArray(data.sections) || data.sections.length === 0) {
    throw new Error('讲义结构不完整');
  }
  return data;
}

export async function lessonTask(lease: JobLease): Promise<void> {
  const job = await db.generationJob.findUniqueOrThrow({ where: { id: lease.jobId } });
  const payload = (job.payload ?? {}) as {
    subjectText?: string;
    tags?: string[];
    target?: string;
    sectionRef?: string;
  };

  try {
    await touchJob(lease, '生成讲义正文');
    let lesson: LessonStructure;
    if (!hasModelCredentials()) {
      if (!env().LUMA_MOCK_AGENT) {
        throw notImplemented('讲义生成（未配置模型且未开启联调模式）');
      }
      lesson = {
        title: '占位讲义（联调模式）',
        sections: [
          { id: 's1', heading: '概念解释', body: '（联调占位）概念解释正文，含 $LaTeX$ 公式示例。' },
          { id: 's2', heading: '分步示例', body: '（联调占位）分步示例正文。' },
          { id: 's3', heading: '易错辨析', body: '（联调占位）易错辨析正文。' },
        ],
        illustrations: [{ sectionId: 's1', caption: '教学配图（待生成）', description: '占位图解说明' }],
      };
    } else {
      lesson = await generateJson<LessonStructure>({
        purpose: 'lesson_body',
        abortSignal: AbortSignal.timeout(Math.max(1, (job.deadlineAt?.getTime() ?? Date.now() + env().JOB_TOTAL_MS) - Date.now())),
        system: await loadPrompt('lesson'),
        prompt: [
          `学习对象：\n${payload.subjectText ?? ''}`,
          `知识点标签：${(payload.tags ?? []).join('、') || '无'}`,
          `讲解目标：${payload.target ?? '生成完整讲义'}`,
          payload.sectionRef ? `局部修订参考段落：${payload.sectionRef}` : '',
          '请输出讲义 JSON：{"title", "sections":[{"id","heading","body"}], "illustrations":[{"sectionId","caption","description"}]}；公式一律 LaTeX。',
        ]
          .filter(Boolean)
          .join('\n'),
        parse: parseLesson,
      });
    }

    // 可恢复草稿检查点：正文完成（§8.4；仅图片步骤失败时可复用）
    await db.generationJob.updateMany({
      where: { id: lease.jobId, status: 'running', leasedBy: lease.workerId },
      data: { draftCheckpoint: { lesson } as unknown as Prisma.InputJsonValue },
    });

    await touchJob(lease, '图文复核');
    if (hasModelCredentials()) {
      // 独立复核调用（§8.4）：不带生成过程，检查图文对应、公式与条件一致
      const review = await generateJson<{ pass: boolean }>({
        purpose: 'lesson_review',
        abortSignal: AbortSignal.timeout(Math.max(1, (job.deadlineAt?.getTime() ?? Date.now() + env().JOB_TOTAL_MS) - Date.now())),
        system: await loadPrompt('review'),
        prompt: [
          '复核以下讲义与学生题目的一致性（图文对应、公式完整、条件一致）。',
          `学生题目：\n${payload.subjectText ?? ''}`,
          `讲义：${JSON.stringify(lesson)}`,
          '输出 {"pass": boolean, "issues": string[]}。',
        ].join('\n'),
        parse: parseReview,
      });
      if (!review.pass) {
        throw new ApiError(ErrorCode.MODEL_UNAVAILABLE, '讲义复核未通过，可重试', 502, true);
      }
    }

    const artifactId = await publishArtifact(lease, 'lesson', { lesson } as unknown as Prisma.InputJsonValue);
    if (artifactId === null) return; // 来源已更新：任务被标记 superseded，旧结果不发布（§8.3）
  } catch (err) {
    if (err instanceof JobLeaseLostError) return; // 租约丢失：旧执行者无权写状态
    throw err; // runner 统一落失败并标记材料失败
  }
}
