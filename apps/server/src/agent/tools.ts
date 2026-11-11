import { z } from 'zod';
import { tool, type ToolSet } from 'ai';
import { TeachingUpdate } from './teaching-state';
import { TeachingReply } from '@luma/shared';
import { LearningAssistance, LearningUpdate } from './learning-contracts';

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
    description: '读取当前对象版本的题目、指定讲义、练习或消息；可按消息游标回读。按权限投影，不含其他会话或其他练习题答案',
    kind: 'short',
    inputSchema: z.object({
      ref: z.enum(['subject', 'artifacts', 'attempt', 'messages', 'tool_result']),
      executionId: z.string().min(1).optional().describe('ref=tool_result必填：旧只读工具结果的执行引用；只取已保存快照，不重放工具'),
      attemptId: z.string().optional().describe('ref=attempt 时必填：练习轮次'),
      sectionId: z.string().optional().describe('ref=artifacts 时可选：讲义段落'),
      artifactId: z.string().optional().describe('明确读取当前对象版本下的历史讲义；不读取题组答案'),
      query: z.string().trim().min(1).max(120).optional().describe('按中文或数学符号字面搜索当前可读历史，返回索引；找到后再精确/相邻读取，片段不是完整原文'),
      aroundMessageId: z.string().min(1).optional().describe('读取命中消息所属的完整用户轮次'),
      offset: z.number().int().min(0).max(1000000).optional().describe('单条messageIds或tool_result的续读字符偏移'),
      beforeMessageId: z.string().optional().describe('ref=messages 的向前分页游标，使用上次返回的 nextCursor'),
      messageIds: z.array(z.string().min(1)).min(1).max(6).optional().describe('按摘要中的原消息引用精确回读，不与游标混用'),
      limit: z.number().int().min(1).max(10).default(5),
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
    description: '基于已确认的学习对象版本创建图文讲义生成任务（正文与结构化图解→复核），返回任务引用；后台执行',
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
export function nativeToolSet(planning = false, allowedTools?: string[]): ToolSet {
  if (planning) return { planTurn: tool({ description: '判断本轮教学目标。学生请求图文或概念关系/卡点需要图解时记录lesson，不要求图文关键词；自主图解用source=teaching_decision并填reason，学生请求用student_request。已有同范围适用讲义时填reuseArtifactId，指定段落改写不能复用旧版。仅明确要练习才记录practice；明确只要简短提示或暂不生成时服从。无需材料的短问答goals=[]。solutionRequested仅在主动索要完整答案时为true。memories摘取本轮明确讲法要求、卡点或尝试，quote必须为学生本轮逐字原话，不能把自主教学理由写成学生原话。', inputSchema: turnPlanSchema }) };
  const set: ToolSet = {
    respond: tool({
      description: '向学生回复并结束本次执行：wait_user 等待学生，finish 表示本次目标已全部完成。不能与业务工具同时调用。',
      inputSchema: respondSchema,
    }),
  };
  for (const def of toolDefinitions) {
    if (allowedTools && !allowedTools.includes(def.name)) continue;
    set[def.name] = tool({ description: def.description, inputSchema: def.inputSchema });
  }
  return set;
}

/** 控制工具同样注册到模型；由驱动器提交，不交给业务执行器。 */
export const respondSchema = z.object({
  disposition: z.enum(['wait_user', 'finish']),
  content: TeachingReply.describe('有序教学内容块。paragraph为正文（可含行内公式），heading为步骤标题，formula为独立公式；text仅填内容，不填HTML或JSON字符串。'),
  refs: z.array(z.unknown()).optional(),
  teaching: TeachingUpdate.optional(),
  learning: LearningUpdate.optional().describe('连续伴学时保存有来源的路线/短验证候选。只能引用学习数据中实际ID与版本；普通短问答不强制建路线。'),
  assistance: LearningAssistance.optional().describe('本次针对待回答短验证提供的帮助：none/hint/explanation/solution。遗漏按explanation保守记录。'),
  clarification: z.object({ reason: z.enum(['history_ambiguous', 'subject_correction']), question: z.string().min(1).max(500) }).optional(),
});

/** Control metadata, not an extra business tool or a nested intent Agent. */
export const turnPlanSchema = z.object({
  contentProfileId: z.enum(['math', 'unconfigured']).optional().describe('根据当前真实学习目标选择内容配置，首期只有math；语言、文史或不明确范围用unconfigured，不能因默认产品学科套数学。'),
  memories: z.array(z.object({
    kind: z.enum(['request', 'difficulty', 'attempt', 'open_question', 'constraint']),
    text: z.string().trim().min(1).max(600),
    quote: z.string().trim().min(1).max(600),
  })).max(6).describe('必须分析本轮学生明确要求和卡点；仅摘取当前原话支持的条目，普通过程无新条目时为空，不能编造已验证结论'),
  goals: z.array(z.object({
    type: z.enum(['lesson', 'practice']),
    source: z.enum(['student_request', 'teaching_decision']).optional(),
    reason: z.string().trim().min(1).max(300).optional().describe('主动图解的简短教学依据，不是内部推理或学生原话'),
    reuseArtifactId: z.string().min(1).optional().describe('仅lesson可用：已有同范围适用讲义ID；改写/换例子时不填'),
    target: z.string().max(500).optional(), count: z.number().int().min(2).max(3).optional(), difficulty: z.enum(['basic','variant','transfer']).optional(),
  }).superRefine((goal, ctx) => {
    if (goal.source === 'teaching_decision' && (goal.type !== 'lesson' || !goal.reason)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '自主教学仅可创建有依据的图文目标' });
    if (goal.reuseArtifactId && goal.type !== 'lesson') ctx.addIssue({ code: z.ZodIssueCode.custom, message: '仅可复用讲义，不复用题组作答目标' });
  })).max(2),
  solutionRequested: z.boolean(),
  conditionCorrection: z.boolean().optional().describe('学生明确更正已确认题干条件时为true，必须回题干修改/确认；普通计算尝试改正为false'),
});
