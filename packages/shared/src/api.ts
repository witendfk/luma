import { z } from 'zod';
import { ExplicitAction } from './enums';

/**
 * API 请求/响应核心契约（设计文档 §10）。
 * 首期只沉淀最核心的一轮对话与通用分页结构，其余接口契约随开发补充到本文件。
 */

/** POST /conversations/:id/turns 的一轮输入（设计文档 §4.1） */
export const TurnRequest = z.object({
  /** 幂等标识：同一请求重试复用，学生发起新操作生成新标识 */
  requestId: z.string().min(8).max(64),
  /** 学生输入文字（可与图片同时为空？不允许——至少一项） */
  text: z.string().max(8000).optional(),
  /** 上传完成的图片附件 */
  imageAttachmentIds: z.array(z.string()).max(3).optional(),
  /** 明确操作；自由输入时不传，由服务端判定意图 */
  action: z.nativeEnum(ExplicitAction).optional(),
  /** 客户端已知的题目版本，冲突时返回 REVISION_CONFLICT */
  subjectId: z.string().min(1).optional(),
  expectedRevision: z.number().int().positive().optional(),
  /** 携题追问的上下文引用 */
  artifactId: z.string().optional(),
  artifactVersion: z.number().int().positive().optional(),
  sectionId: z.string().optional(),
  attemptId: z.string().optional(),
  exerciseId: z.string().optional(),
  /** 显式重试来源运行（设计文档 §10：显式重试携带新 requestId 及 retryOfRunId） */
  retryOfRunId: z.string().optional(),
});
export type TurnRequest = z.infer<typeof TurnRequest>;

/** 分页查询通用参数 */
export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** 游标分页通用响应 */
export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

/** 统一响应包装：数据或错误二选一，HTTP 状态码配合使用 */
export const ApiBody = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
      requestId: z.string().optional(),
    }),
  }),
]);

/** Stable object identity and version identity are deliberately separate. Dates are ISO strings over HTTP. */
export type LearningIntent = 'question' | 'knowledge' | 'practice';
export interface SubjectView {
  id: string;
  subjectId: string;
  version: number;
  type: 'question' | 'knowledge';
  content: { text?: string; intent?: LearningIntent; [key: string]: unknown };
  tags: string[];
  subquestions?: string[] | null;
  activeSubquestionIndex?: number | null;
  confirmedAt: string | null;
}
export interface ProgressView {
  subjectId: string;
  subjectRevisionId: string | null;
  version: number;
  stage: string;
  destination: 'chat' | 'reader' | 'practice';
  draft: string;
  currentArtifactId: string | null;
  currentSectionId: string | null;
  currentAttemptId: string | null;
  currentExerciseId: string | null;
}
export interface LearningSubjectView {
  id: string;
  order: number;
  revision: SubjectView | null;
  progress: ProgressView | null;
  collected: boolean;
}
export interface ConversationSummary {
  id: string; title: string; lastActiveAt: string; archivedAt: string | null;
}
export interface ConversationDetail {
  conversation: ConversationSummary & { activeSubjectId?: string | null; learnAll?: boolean };
  subjects: LearningSubjectView[];
  subject: SubjectView | null;
  progress: ProgressView | null;
  artifacts: Array<{ id: string; type: 'lesson' | 'exercise_set'; publishStatus: string; subjectId: string; subjectRevisionId: string }>;
  activeRun?: { id: string; status: string } | null;
  latestRun?: { id: string; status: string; error: { code?: string; message?: string; retryable?: boolean } | null } | null;
  lessonJob?: { id: string; status: string; step: string | null } | null;
  materialTasks?: MaterialTaskView[];
}
/** Persisted material task scoped to its teaching turn; no lesson body or exercise answers. */
export interface MaterialTaskView {
  id: string;
  jobId: string | null;
  runId: string | null;
  userMessageId: string | null;
  subjectRevisionId: string | null;
  type: 'lesson' | 'exercise_set';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'superseded';
  step: string | null;
  artifactId: string | null;
  title: string;
  summary: string;
  historical: boolean;
  error: { message: string; retryable: boolean } | null;
}
export const SubjectContent = z.object({ text: z.string().trim().min(1).max(8000), intent: z.enum(['question', 'knowledge', 'practice']).optional() }).passthrough();
export const CreateSubjectRequest = z.object({ type: z.enum(['question', 'knowledge']), content: SubjectContent });
export const ReviseSubjectRequest = z.object({
  expectedRevision: z.number().int().positive(),
  content: SubjectContent.optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  subquestions: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
  subquestionIndex: z.number().int().min(0).optional(),
});
export const FocusRequest = z.object({ subjectId: z.string().min(1), learnAll: z.boolean().optional() });
export const ProgressRequest = z.object({
  expectedRevision: z.number().int().positive(),
  expectedVersion: z.number().int().min(0),
  destination: z.enum(['chat', 'reader', 'practice']),
  draft: z.string().max(2000).optional(),
  artifactId: z.string().optional(), sectionId: z.string().optional(),
  attemptId: z.string().optional(), exerciseId: z.string().optional(),
});
export type ProgressRequest = z.infer<typeof ProgressRequest>;
export interface AttemptAnswerView {
  textDraft: string | null; photoIds: string[]; markedUnknown: boolean;
  hintsUsed: number; solutionViewedAt: string | null;
  selfEval: 'independent' | 'partial' | 'stuck' | null; draftVersion: number;
}
export interface ExerciseView {
  id: string; order: number; stem: string; topic: string; difficulty: string; purpose: string;
}
export interface AttemptView {
  id: string; artifactId: string; conversationId: string; subjectId: string; subjectRevisionId: string;
  stage: 'intro' | 'doing' | 'review' | 'summary'; currentExerciseId: string | null;
  submittedAt: string | null; completedAt: string | null; answersHidden: boolean;
  exercises: Array<ExerciseView & { answer?: string; analysis?: string; myAnswer: AttemptAnswerView | null }>;
}
export interface AttemptHistoryItem {
  id: string; artifactId: string; stage: AttemptView['stage']; currentExerciseId: string | null;
  createdAt: string; submittedAt: string | null; completedAt: string | null;
}
