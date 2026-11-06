import { z } from 'zod';

const coordinate = z.number().finite().min(-10000).max(10000);
const bounds = z.object({ xMin: coordinate, xMax: coordinate, yMin: coordinate, yMax: coordinate })
  .refine((b) => b.xMax - b.xMin >= .1 && b.yMax - b.yMin >= .1, '绘图范围无效');
export const TeachingGraphic = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('quadratic'), a: z.number().finite().min(-1000).max(1000).refine((n) => Math.abs(n) >= .001), b: coordinate, c: coordinate,
    bounds, caption: z.string().min(1).max(300), revealValues: z.boolean().default(false) }),
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
  diagrams: z.array(z.object({ sectionId: z.string(), content: Diagram })).length(1),
}).superRefine((value, ctx) => {
  const ids = new Set(value.sections.map((s) => s.id));
  if (ids.size !== value.sections.length || value.diagrams.some((i) => !ids.has(i.sectionId))) ctx.addIssue({ code: 'custom', message: '章节或图解引用无效' });
});
export type Lesson = z.infer<typeof Lesson>;
export interface RichNode { name?: string; type?: string; text?: string; attrs?: Record<string, string>; children?: RichNode[] }
export interface ContentBlock { kind: 'text' | 'formula'; nodes?: RichNode[]; src?: string; width?: number; height?: number; fallback?: string }
export interface LessonView {
  id: string; type: 'lesson'; version: number; publishStatus: string; subjectId: string; subjectRevisionId: string;
  subject: { text: string; tags: string[]; confirmed: boolean }; content: { lesson: Lesson };
}
