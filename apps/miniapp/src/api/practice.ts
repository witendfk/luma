import type { SelfEval } from '@luma/shared';
import { request } from '@/utils/request';

/** 练习闭环接口（FR-06/07/08）；答案侧信息只在 submit 后由服务端投影返回 */

export type { AttemptView, ExerciseView } from '@luma/shared';
import type { AttemptView, AttemptHistoryItem } from '@luma/shared';

export function startAttempt(artifactId: string, exerciseIds?: string[]): Promise<AttemptView> {
  return request<AttemptView>({ method: 'POST', path: '/api/practice-attempts', data: { artifactId, exerciseIds } });
}

export function getAttempt(id: string): Promise<AttemptView> {
  return request<AttemptView>({ method: 'GET', path: `/api/practice-attempts/${id}` });
}

export interface SaveAnswerInput {
  textDraft?: string;
  photoIds?: string[];
  markedUnknown?: boolean;
  hintsUsed?: number;
  selfEval?: SelfEval;
  draftVersion: number;
}

export function saveAnswer(attemptId: string, exerciseId: string, input: SaveAnswerInput): Promise<void> {
  return request<void>({
    method: 'PUT',
    path: `/api/practice-attempts/${attemptId}/answers/${exerciseId}`,
    data: input,
  });
}

export function submitAttempt(attemptId: string): Promise<unknown> {
  return request<unknown>({ method: 'POST', path: `/api/practice-attempts/${attemptId}/submit` });
}

export function completeAttempt(attemptId: string): Promise<unknown> {
  return request<unknown>({ method: 'POST', path: `/api/practice-attempts/${attemptId}/complete` });
}

export function listAttempts(artifactId: string): Promise<AttemptHistoryItem[]> {
  return request({ method: 'GET', path: `/api/artifacts/${artifactId}/attempts` });
}
