import { env } from '../lib/env';
import { notImplemented } from '../lib/errors';
import { publishArtifact, touchJob, type JobLease } from './shared';

/**
 * 图文讲义任务（设计文档 §8.1）：
 * 生成讲义结构 → 保存文字草稿（前端显示「配图生成中」）→ 按图解要求生成配图并存对象存储
 * → 图文复核（不通过修复一次）→ 发布。
 * 每步推进进度；配图失败只重试相应步骤；来源题目已改变时任务被标记 superseded。
 */
export async function lessonTask(lease: JobLease): Promise<void> {
  await touchJob(lease, '生成讲义结构');
  await touchJob(lease, '生成正文草稿');

  if (!env().LUMA_MOCK_AGENT) {
    // TODO(第一周)：GPT 正文生成（lesson.md）→ 配图生成与上传 → 图文复核（review.md）
    throw notImplemented('讲义生成（GPT 正文 + 配图 + 复核）');
  }

  // 联调模式：产出占位讲义，前端在未配置模型时也能走通流程
  await publishArtifact(lease, 'lesson', { placeholder: true, title: '占位讲义（联调模式）' });
}
