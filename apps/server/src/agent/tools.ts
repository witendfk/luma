import { z } from 'zod';
import { tool, type ToolSet } from 'ai';

/**
 * 业务工具定义（设计文档 §6）：收敛为 4 个。
 * 练习追问由主 Agent 直接回应，不再设 explainExercise（§6 收敛说明）。
 * 工具通过原生 function calling 暴露，不注册 execute（§4.10）；
 * 参数/权限校验与真实执行在 tool-executor.ts。
 */

export type ToolKind = 'short' | 'job';

export interface ToolDefinition {
  name: string;
  description: string;
  kind: ToolKind;
  inputSchema: z.ZodType;
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'readLearningContext',
    description: '读取当前会话内的题目、材料概览、练习轮次或近期消息片段及状态；按权限投影，不含其他会话',
    kind: 'short',
    inputSchema: z.object({
      ref: z.enum(['subject', 'artifacts', 'attempt', 'messages']),
      attemptId: z.string().optional().describe('ref=attempt 时必填：练习轮次'),
      sectionId: z.string().optional().describe('ref=artifacts 时可选：讲义段落'),
    }),
  },
  {
    name: 'recognizeMaterial',
    description: '识别本人上传图片：转写题干/公式/图形条件/小问或解题过程，标出需确认内容；不自动标记为已确认',
    kind: 'short',
    inputSchema: z.object({
      attachmentId: z.string().min(1),
      materialType: z.enum(['question', 'process']),
    }),
  },
  {
    name: 'createLesson',
    description: '基于已确认的学习对象版本创建图文讲义生成任务（正文→配图→复核），返回任务引用；后台执行',
    kind: 'job',
    inputSchema: z.object({
      target: z.string().min(1).describe('讲解目标与范围（如：讲清对称轴，含图解）'),
      sectionRef: z.string().optional().describe('局部重讲/换例子时的原讲义段落引用'),
    }),
  },
  {
    name: 'createPractice',
    description: '按已确认知识范围创建 2-3 道同类练习的题组任务（出题→复核），返回任务引用；后台执行',
    kind: 'job',
    inputSchema: z.object({
      count: z.number().int().min(2).max(3).default(2),
      difficulty: z.enum(['basic', 'variant', 'transfer']).optional(),
    }),
  },
];

export function findToolDefinition(name: string): ToolDefinition | undefined {
  return toolDefinitions.find((t) => t.name === name);
}

/** 原生工具集：只传名称、说明与参数 schema，无 execute（§4.10） */
export function nativeToolSet(): ToolSet {
  const set: ToolSet = {
    respond: tool({
      description: '向学生回复并结束本次执行：wait_user 等待学生，finish 表示本次目标已全部完成。不能与业务工具同时调用。',
      inputSchema: respondSchema,
    }),
  };
  for (const def of toolDefinitions) {
    set[def.name] = tool({ description: def.description, inputSchema: def.inputSchema });
  }
  return set;
}

/** 控制工具同样注册到模型；由驱动器提交，不交给业务执行器。 */
export const respondSchema = z.object({
  disposition: z.enum(['wait_user', 'finish']),
  text: z.string().min(1),
  refs: z.array(z.unknown()).optional(),
});
