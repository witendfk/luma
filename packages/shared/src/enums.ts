/**
 * 领域枚举 —— 与 [设计文档](../../../设计文档.md) §3 教学状态、§8 任务状态、§9 数据结构保持一致。
 * 命名即文档术语，前后端共用，不允许小程序端自行发明状态。
 */

/** 教学阶段（设计文档 §3.2） */
export const TeachingStage = {
  /** 题目待核对或知识范围待澄清 */
  clarifying: 'clarifying',
  /** 引导学生表达和修正思路 */
  guiding: 'guiding',
  /** 展开完整解析或图文讲解 */
  explaining: 'explaining',
  /** 围绕同知识点练习 */
  practicing: 'practicing',
  /** 回看材料与练习结果 */
  reviewing: 'reviewing',
} as const;
export type TeachingStage = (typeof TeachingStage)[keyof typeof TeachingStage];

/** 练习状态（设计文档 §3.3） */
export const PracticeStage = {
  intro: 'intro',
  doing: 'doing',
  review: 'review',
  summary: 'summary',
} as const;
export type PracticeStage = (typeof PracticeStage)[keyof typeof PracticeStage];

/** 学习对象类型（设计文档 §3.1） */
export const SubjectType = {
  question: 'question',
  knowledge: 'knowledge',
} as const;
export type SubjectType = (typeof SubjectType)[keyof typeof SubjectType];

/** 生成任务状态（设计文档 §8.3） */
export const JobStatus = {
  queued: 'queued',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  /** 来源题目已改变，旧结果不再成为当前成果 */
  superseded: 'superseded',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/** 成果材料类型（设计文档 §9 Artifact） */
export const ArtifactType = {
  /** 图文讲义 */
  lesson: 'lesson',
  /** 题组（同类练习） */
  exercise_set: 'exercise_set',
} as const;
export type ArtifactType = (typeof ArtifactType)[keyof typeof ArtifactType];

/** 材料发布状态：入口区分未生成/生成中/已完成/失败（设计文档 §9 数据约束） */
export const PublishStatus = {
  generating: 'generating',
  published: 'published',
  failed: 'failed',
} as const;
export type PublishStatus = (typeof PublishStatus)[keyof typeof PublishStatus];

/** 消息角色 */
export const MessageRole = {
  user: 'user',
  assistant: 'assistant',
} as const;
export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

/** 消息完成状态；停止生成的消息标记为 incomplete（设计文档 §5.2） */
export const MessageStatus = {
  complete: 'complete',
  incomplete: 'incomplete',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/** 自评结果（FR-08：独立做对、部分会、还不会） */
export const SelfEval = {
  independent: 'independent',
  partial: 'partial',
  stuck: 'stuck',
} as const;
export type SelfEval = (typeof SelfEval)[keyof typeof SelfEval];

/** 复习状态由学生手动确认（FR-09） */
export const ReviewStatus = {
  to_review: 'to_review',
  reviewed: 'reviewed',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

/** 一轮输入可携带的明确操作（设计文档 §4.1） */
export const ExplicitAction = {
  ask: 'ask',
  hint: 'hint',
  show_solution: 'show_solution',
  generate_lesson: 'generate_lesson',
  generate_practice: 'generate_practice',
  followup: 'followup',
  change_example: 'change_example',
} as const;
export type ExplicitAction = (typeof ExplicitAction)[keyof typeof ExplicitAction];

/** 附件用途（设计文档 §9 Attachment） */
export const AttachmentPurpose = {
  /** 题目原图 */
  question_origin: 'question_origin',
  /** 解题过程照片 */
  process_photo: 'process_photo',
  /** 练习作答照片 */
  answer_photo: 'answer_photo',
  /** 讲义教学配图 */
  lesson_illustration: 'lesson_illustration',
  /** 知识点教学的学生材料 */
  knowledge_material: 'knowledge_material',
} as const;
export type AttachmentPurpose = (typeof AttachmentPurpose)[keyof typeof AttachmentPurpose];
