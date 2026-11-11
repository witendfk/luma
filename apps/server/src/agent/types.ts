import type { ExplicitAction } from '@luma/shared';

/** 任务记录与协议相关内部类型（设计文档 §4.3 / §4.11） */

/** TaskFrame：学生目标与已验证成果，记录可核验的工作进展，不是模型思维链 */
export interface TaskFrameGoal {
  type: 'lesson' | 'practice';
  source?: 'student_request' | 'teaching_decision';
  reason?: string;
  reuseArtifactId?: string;
  target?: string;
  count?: number;
  difficulty?: 'basic' | 'variant' | 'transfer';
  /** 已登记的材料任务（deferred 时记录） */
  startedJobId?: string;
  /** 只能由真实工具结果证明完成（§4.11） */
  completedArtifactId?: string;
  failure?: boolean;
}

export interface TaskFrame {
  contentProfile?: import('./content-profile').ContentProfileRef;
  memoryCandidates?: Array<{kind: 'request' | 'difficulty' | 'attempt' | 'open_question' | 'constraint'; text: string; quote: string}>;
  conditionCorrection?: boolean;
  readback?: { reason: 'history_reference'; status: 'pending' | 'read' | 'clarified'; triggerMessageId: string;
    sourceMessageIds: string[]; candidateMessageIds: string[]; ranges: Record<string, number> };
  memoryWrite?: { accepted: string[]; rejected: Array<{index: number; code: string}> };
  /** chat=自由输入；solution=主动查看解析；material=含材料生成目标 */
  kind: 'chat' | 'solution' | 'material';
  /** Explicit buttons are preplanned; free text uses one control decision in the same driver. */
  planned?: boolean;
  historyCount?: number;
  solutionRequested?: boolean;
  action?: ExplicitAction;
  practiceMode?: 'ensure';
  focus?: {
    artifactId?: string;
    artifactVersion?: number;
    sectionId?: string;
    attemptId?: string;
    exerciseId?: string;
  };
  goals: TaskFrameGoal[];
}

export function taskFrameFrom(json: unknown): TaskFrame {
  const base: TaskFrame = { kind: 'chat', goals: [] };
  if (!json || typeof json !== 'object') return base;
  const src = json as Partial<TaskFrame>;
  return {
    contentProfile: src.contentProfile,
    memoryWrite: src.memoryWrite,
    conditionCorrection: src.conditionCorrection,
    memoryCandidates: src.memoryCandidates,
    readback: src.readback,
    kind: src.kind ?? 'chat',
    planned: src.planned ?? true,
    historyCount: src.historyCount ?? 0,
    solutionRequested: src.solutionRequested ?? false,
    action: src.action,
    practiceMode: src.practiceMode,
    focus: src.focus,
    goals: Array.isArray(src.goals) ? src.goals : [],
  };
}

/** pendingBatch 持久化结构（§4.12） */
export interface PendingBatch {
  decisionId: string;
  items: Array<{ toolCallId: string; toolName: string; input: unknown }>;
}
