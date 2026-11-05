import { db } from '../lib/db';
import type { ExplicitAction } from '@luma/shared';

/**
 * TurnPolicy（设计文档 §4.6）：服务端根据真实状态计算工具与答案权限，模型不能自行授予。
 */

export interface TurnPolicy {
  subjectId: string;
  stage: string;
  subjectRevisionId: string | null;
  subjectConfirmed: boolean;
  /** 本轮允许的业务工具白名单 */
  allowedTools: string[];
  /** 是否可向模型/工具加载参考答案（默认否；仅授权后针对当前对象） */
  answerPermission: boolean;
  /** 本轮是否授权输出完整解析 */
  allowSolution: boolean;
  focus: {
    artifactId?: string;
    sectionId?: string;
    attemptId?: string;
    exerciseId?: string;
  };
}

export async function buildPolicy(input: {
  conversationId: string;
  subjectId: string;
  action?: ExplicitAction;
  focus?: { artifactId?: string; sectionId?: string; attemptId?: string; exerciseId?: string };
}): Promise<TurnPolicy> {
  const [progress, subject] = await Promise.all([
    db.learningProgress.findUnique({ where: { subjectId: input.subjectId } }),
    db.subjectRevision.findFirst({
      where: { subjectId: input.subjectId },
      orderBy: { version: 'desc' },
    }),
  ]);
  const confirmed = Boolean(subject?.confirmedAt);
  const stage = progress?.stage ?? 'clarifying';

  // §4.6 场景表：未确认只开放识别与澄清；确认后开放全部业务工具
  const allowedTools = confirmed
    ? ['readLearningContext', 'recognizeMaterial', 'createLesson', 'createPractice']
    : ['readLearningContext', 'recognizeMaterial'];

  return {
    subjectId: input.subjectId,
    stage,
    subjectRevisionId: subject?.id ?? null,
    subjectConfirmed: confirmed,
    allowedTools,
    answerPermission: false,
    allowSolution: input.action === 'show_solution' && confirmed,
    focus: input.focus ?? {},
  };
}
