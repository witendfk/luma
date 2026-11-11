import { z } from 'zod';
import { LearningVerdict } from '@luma/shared';

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
    node: z.object({ id: z.string().min(1), action: z.enum(['learn', 'skip']) }).optional(),
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
  }).strict(),
]);
export type LearningUpdate = z.infer<typeof LearningUpdate>;
export const LearningAssistance = z.enum(['none', 'hint', 'explanation', 'solution']);
