import { z } from 'zod';
import { LearningVerdict } from '@luma/shared';
import type { TurnPolicy } from './policy';
import type { TaskFrame } from './types';

const Key = z.string().trim().min(1).max(40);
export const PassCriteria = z.array(z.object({
  id: Key, description: z.string().trim().min(4).max(300), requiresIndependent: z.boolean().default(true),
}).strict()).min(1).max(4).superRefine((rows, ctx) => {
  if (new Set(rows.map((r) => r.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: '验证条件ID重复' });
});
const CheckTask = z.object({
  prompt: z.string().trim().min(4).max(1200), taskKind: z.enum(['judgment', 'explanation', 'comparison', 'application']),
});
const Node = z.object({
  key: Key, objective: z.string().trim().min(4).max(240),
  prerequisites: z.array(Key).max(7).default([]), criteria: PassCriteria,
}).strict();
export const LearningUpdate = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), goal: z.string().trim().min(4).max(300),
    goalQuote: z.string().trim().min(2).max(600), nodes: z.array(Node).min(1).max(8),
    replaces: z.object({ routeId: z.string().min(1), expectedVersion: z.number().int().positive() }).optional(),
    initialCheck: CheckTask.extend({ nodeKey: Key }).optional(),
  }).strict(),
  z.object({ action: z.literal('update'), routeId: z.string().min(1), expectedVersion: z.number().int().positive(),
    status: z.enum(['active', 'paused', 'ended']).optional(),
    studentQuote: z.string().trim().min(2).max(600).optional(),
    node: z.object({ id: z.string().min(1), action: z.enum(['learn', 'skip', 'revisit']) }).optional(),
    check: z.discriminatedUnion('action', [
      CheckTask.extend({ action: z.literal('issue'), nodeId: z.string().min(1) }),
      z.object({ action: z.literal('evaluate'), checkId: z.string().min(1),
        evaluation: LearningVerdict,
        criteriaResults: z.array(z.object({ criterionId: Key, met: z.boolean(),
          evidenceType: z.enum(['reasoning', 'application', 'comparison', 'judgment', 'self_report', 'repetition', 'unclear']),
          quote: z.string().max(1200), feedback: z.string().trim().min(1).max(400),
        }).strict()).min(1).max(4),
      }).strict(),
    ]).optional(),
    followupCheck: CheckTask.extend({ nodeId: z.string().min(1) }).optional(),
  }).strict(),
]).superRefine((update, ctx) => {
  if (update.action === 'update' && update.followupCheck &&
    (update.check?.action !== 'evaluate' || ['paused', 'ended'].includes(update.status ?? ''))) {
    ctx.addIssue({ code: 'custom', path: ['followupCheck'], message: '后续短验证须与当前评价一起提交，且路线保持学习中' });
  }
});
export type LearningUpdate = z.infer<typeof LearningUpdate>;
export const LearningAssistance = z.enum(['none', 'hint', 'explanation', 'solution']);

/** Enforce the planned output, without inventing a course or adding a second planning Agent. */
export function validateLearningIntent(frame: TaskFrame, policy: TurnPolicy, update?: LearningUpdate) {
  const eligible = policy.subjectConfirmed && frame.contentProfile?.id === 'math' && !policy.allowSolution
    && !policy.focus.attemptId && !policy.focus.sectionId;
  if (eligible && frame.learningIntent === 'start' && update?.action !== 'create') {
    return { ok: false as const, message: '本轮已规划开始连续伴学，但未提交学习路线。请在respond.learning中提交create候选：引用本轮学生原话goalQuote，设置少量有明确目标和可观察criteria的节点。讲义或正文安排不能替代路线；已有路线则按学习数据续学，不重复创建。' };
  }
  return null;
}
