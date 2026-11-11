import { z } from 'zod';

export const LearningNodeStatus = z.enum(['pending', 'learning', 'checked', 'needs_review', 'skipped']);
export const LearningSupport = z.enum(['independent', 'hinted', 'explained', 'solution_seen', 'skipped']);
export const LearningVerdict = z.enum(['pass', 'needs_review', 'insufficient_evidence', 'uncertain']);
export const LearningRouteAction = z.object({
  requestId: z.string().min(8).max(64), routeId: z.string().min(1), expectedVersion: z.number().int().positive(),
  action: z.enum(['pause', 'resume', 'skip', 'revisit']), nodeId: z.string().min(1).optional(),
}).strict();
export type LearningRouteAction = z.infer<typeof LearningRouteAction>;

/** Student projection deliberately excludes rubric internals and reference answers. */
export const LearningRouteSnapshot = z.object({
  id: z.string().min(1), version: z.number().int().positive(), goal: z.string(), status: z.enum(['active', 'paused', 'ended']),
  subjectRevisionId: z.string(), contentProfileId: z.string(), contentProfileVersion: z.string(),
  createdAt: z.string().datetime(),
  currentNodeId: z.string().nullable(),
  nodes: z.array(z.object({ id: z.string(), objective: z.string(), position: z.number().int(), status: LearningNodeStatus,
    version: z.number().int().positive(), check: z.object({ id: z.string(), prompt: z.string(),
      evaluation: LearningVerdict.nullable(), supportLevel: LearningSupport }).nullable(),
  })),
});
export type LearningRouteView = z.infer<typeof LearningRouteSnapshot>;
