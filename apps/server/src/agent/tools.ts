import { z } from 'zod';
import { notImplemented } from '../lib/errors';
import type { TurnContext } from './types';

/**
 * 教学工具（设计文档 §6）。工具在服务端执行；账号标识取自登录态，
 * 题目等来源引用由服务端核验，模型不能直接写库或调用未知地址。
 *
 * kind：
 *  - short：本轮内执行，结果交回模型继续推理（§4.2 第 6 步）
 *  - job：长生成任务，登记 GenerationJob 后返回任务引用，结束本轮（§4.2 第 7 步）
 */
export interface ToolContext {
  userId: string;
  conversationId: string;
  subjectRevisionId?: string;
  runId: string;
}

export interface TeachingTool {
  name: string;
  description: string;
  kind: 'short' | 'job';
  /** Zod schema：工具参数进入模型前先经 parse 校验（§4.2 第 6 步） */
  inputSchema: z.ZodType;
  execute(input: unknown, ctx: ToolContext): Promise<unknown>;
}

function stubTool(name: string, description: string, kind: 'short' | 'job', inputSchema: z.ZodType): TeachingTool {
  return {
    name,
    description,
    kind,
    inputSchema,
    execute: async () => {
      throw notImplemented(`教学工具 ${name}`);
    },
  };
}

export const teachingTools: TeachingTool[] = [
  stubTool(
    'readLearningContext',
    '读取当前会话内的题目、讲义、练习或消息片段及状态',
    'short',
    z.object({
      ref: z.enum(['subject', 'lesson', 'practice', 'messages']),
      sectionId: z.string().optional(),
      attemptId: z.string().optional(),
    }),
  ),
  stubTool(
    'recognizeMaterial',
    '识别本人上传图片：转写题干/公式/图形条件/小问，或逐段转写解题过程，标出需确认内容',
    'short',
    z.object({
      attachmentId: z.string().min(1),
      materialType: z.enum(['question', 'process']),
    }),
  ),
  stubTool(
    'createLesson',
    '基于当前学习对象版本创建图文讲义任务，返回任务引用（后台执行）',
    'job',
    z.object({
      target: z.string().min(1).describe('讲解目标与范围'),
      sectionRef: z.string().optional().describe('局部重讲/换例子时的段落引用'),
    }),
  ),
  stubTool(
    'createPractice',
    '按已确认知识范围创建 2-3 道同类练习的题组任务，返回任务引用（后台执行）',
    'job',
    z.object({
      count: z.number().int().min(2).max(3).default(2),
      difficulty: z.enum(['basic', 'variant', 'transfer']).optional(),
    }),
  ),
  stubTool(
    'explainExercise',
    '针对练习题与作答给引导或解析；solution 模式需本轮已获授权且只返回当前题',
    'short',
    z.object({
      exerciseId: z.string().min(1),
      mode: z.enum(['guide', 'solution']),
    }),
  ),
];

export function findTool(name: string): TeachingTool | undefined {
  return teachingTools.find((t) => t.name === name);
}

export type { TurnContext };
