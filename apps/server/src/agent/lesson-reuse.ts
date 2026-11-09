import type { TurnPolicy } from './policy';

/** Check permission separately from the model's judgement that a lesson is useful. */
export function canReuseLesson(policy: TurnPolicy, payload: unknown): boolean {
  const source = payload as { answerPermission?: boolean; evidence?: { focus?: { attemptId?: string; exerciseId?: string } } } | null;
  if (!source) return false;
  if (source?.answerPermission && !policy.allowSolution) return false;
  const focus = source?.evidence?.focus;
  return (focus?.attemptId ?? null) === (policy.focus.attemptId ?? null)
    && (focus?.exerciseId ?? null) === (policy.focus.exerciseId ?? null);
}
