import { env } from '../lib/env';
import { notImplemented } from '../lib/errors';
import { publishArtifact, touchJob, type JobLease } from './shared';

/**
 * 题组任务（设计文档 §8.2）：
 * 生成 2-3 道题 → 另一次调用复核（条件完整性/可解性/答案一致，允许修复一次）
 * → 通过后保存并发布题组；未通过不进入在线练习。
 */
export async function practiceTask(lease: JobLease): Promise<void> {
  await touchJob(lease, '生成题目');
  await touchJob(lease, '复核与修复');

  if (!env().LUMA_MOCK_AGENT) {
    // TODO(第一周)：GPT 出题（practice.md）→ 复核（review.md）→ 发布
    throw notImplemented('题组生成（GPT 出题 + 复核）');
  }

  // 联调模式：两道占位题，验证练习闭环各阶段流转
  await publishArtifact(lease, 'exercise_set', { placeholder: true, count: 2 },
    [1, 2].map((order) => ({
      order,
      stem: `占位练习题 ${order}（联调模式）：求 $f(x)=x^2$ 在 $[0,1]$ 上的最小值。`,
      topic: '联调占位',
      difficulty: 'basic',
      purpose: '验证练习闭环流程',
      answer: '0（占位答案）',
      analysis: '占位解析：作答阶段不应下发本字段（§8.2 题目侧/答案侧分离投影）。',
    })),
  );
}
