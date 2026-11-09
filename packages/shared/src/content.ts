import { z } from 'zod';

/** 模型负责内容，应用负责排版；禁止把工具 JSON 当成正文。 */
export const TeachingReply = z.array(z.object({
  type: z.enum(['paragraph', 'heading', 'formula']),
  text: z.string().trim().min(1).max(2000),
}).strict()).min(1).max(32).superRefine((blocks, ctx) => {
  if (blocks.reduce((n, b) => n + b.text.length, 0) > 12000) ctx.addIssue({ code: 'custom', message: '回复过长' });
  blocks.forEach((block, i) => {
    if (block.type === 'heading' && block.text.length > 160) ctx.addIssue({ code: 'custom', path: [i, 'text'], message: '标题过长' });
    if (block.type === 'formula' && (block.text.length > 1500 || /\$|\\[\[\]()]/.test(block.text))) ctx.addIssue({ code: 'custom', path: [i, 'text'], message: '公式使用不带定界符的LaTeX' });
  });
});
export type TeachingReply = z.infer<typeof TeachingReply>;
/** 文本投影供历史检索/上下文和流式预览使用，展示优先采用结构化内容。 */
export function teachingReplyText(blocks: TeachingReply): string {
  return blocks.map((block) => block.type === 'formula' ? `$$${block.text}$$` : block.type === 'heading' ? `### ${block.text}` : block.text).join('\n\n');
}

const coordinate = z.number().finite().min(-10000).max(10000);
const bounds = z.object({ xMin: coordinate, xMax: coordinate, yMin: coordinate, yMax: coordinate })
  .refine((b) => b.xMax - b.xMin >= .1 && b.yMax - b.yMin >= .1, '绘图范围无效');
export const TeachingGraphic = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('quadratic'), a: z.number().finite().min(-1000).max(1000).refine((n) => Math.abs(n) >= .001), b: coordinate, c: coordinate,
    bounds, caption: z.string().min(1).max(300), revealValues: z.boolean().default(false),
    xLabel: z.string().trim().min(1).max(12).optional(), yLabel: z.string().trim().min(1).max(12).optional() }),
  z.object({ kind: z.literal('geometry'), caption: z.string().min(1).max(300),
    points: z.array(z.object({ x: coordinate, y: coordinate, label: z.string().min(1).max(24) })).min(2).max(8),
    edges: z.array(z.tuple([z.number().int().min(0).max(7), z.number().int().min(0).max(7)])).min(1).max(16),
  }),
]);
export type TeachingGraphic = z.infer<typeof TeachingGraphic>;

export const Diagram = z.object({
  title: z.string().trim().min(1).max(160),
  graphic: TeachingGraphic.optional(),
  /** 服务端受控绘制结果，仅供显示；模型输出不能指定地址。 */
  figure: z.string().optional(),
  figureError: z.string().optional(),
  steps: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    detail: z.string().trim().min(1).max(500),
    formula: z.string().trim().max(500).optional(),
  })).min(2).max(5),
  takeaway: z.string().trim().min(1).max(300).optional(),
});
export type Diagram = z.infer<typeof Diagram>;

export const Lesson = z.object({
  title: z.string().trim().min(1).max(160),
  sections: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/), heading: z.string().min(1).max(160), body: z.string().min(1).max(5000) })).min(3).max(6),
  // A lesson may need several views, but one diagram per section keeps mobile reading order clear.
  diagrams: z.array(z.object({ sectionId: z.string(), content: Diagram })).min(1).max(3),
}).superRefine((value, ctx) => {
  const ids = new Set(value.sections.map((s) => s.id));
  const diagramSections = new Set(value.diagrams.map((i) => i.sectionId));
  if (ids.size !== value.sections.length || value.diagrams.some((i) => !ids.has(i.sectionId)) || diagramSections.size !== value.diagrams.length) {
    ctx.addIssue({ code: 'custom', message: '章节或图解引用无效：每节最多一幅图，且必须引用现有章节' });
  }
});
export type Lesson = z.infer<typeof Lesson>;
export interface RichNode { name?: string; type?: string; text?: string; attrs?: Record<string, string>; children?: RichNode[] }
export interface ContentBlock { kind: 'text' | 'formula'; nodes?: RichNode[]; src?: string; width?: number; height?: number; fallback?: string; failed?: boolean }
export interface LessonView {
  id: string; type: 'lesson'; version: number; publishStatus: string; subjectId: string; subjectRevisionId: string;
  subject: { text: string; tags: string[]; confirmed: boolean }; content: { lesson: Lesson };
}
