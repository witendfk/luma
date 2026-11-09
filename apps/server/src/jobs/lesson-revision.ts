import { z } from 'zod';
import { Lesson, Diagram } from '@luma/shared';
import { extractJson } from '../lib/model';

export const LessonSource = z.object({ artifactId: z.string(), artifactVersion: z.number().int().positive(),
  sectionId: z.string(), lesson: Lesson });
export type LessonSource = z.infer<typeof LessonSource>;

/** The model edits one section. Programmatic merge preserves every other section and diagram. */
export function applyLessonPatch(source: LessonSource, raw: string): Lesson {
  const patch = z.object({ section: z.object({ id: z.string(), heading: z.string().min(1).max(160), body: z.string().min(1).max(5000) }),
    diagram: Diagram.nullish() }).parse(extractJson(raw));
  if (patch.section.id !== source.sectionId || !source.lesson.sections.some((s) => s.id === source.sectionId)) throw new Error('局部修订只能修改指定段落');
  if (patch.diagram && !source.lesson.diagrams.some((d) => d.sectionId === source.sectionId)) throw new Error('不能修改其他段落的配图');
  return Lesson.parse({ ...source.lesson,
    sections: source.lesson.sections.map((s) => s.id === source.sectionId ? patch.section : s),
    diagrams: source.lesson.diagrams.map((d) => d.sectionId === source.sectionId && patch.diagram ? { ...d, content: patch.diagram } : d),
  });
}

/** Quality repair replaces only the named existing sections/diagrams, never the whole lesson. */
export function applyLessonRepair(lesson: Lesson, raw: string, sectionScope?: string): Lesson {
  const patch = z.object({
    sections: z.array(z.object({ id: z.string(), heading: z.string(), body: z.string() })).max(6).default([]),
    diagrams: z.array(z.object({ sectionId: z.string(), content: Diagram })).max(3).default([]),
  }).strict().parse(extractJson(raw));
  const sectionIds = patch.sections.map((s) => s.id), diagramIds = patch.diagrams.map((d) => d.sectionId);
  if (!sectionIds.length && !diagramIds.length) throw new Error('修复内容不能为空');
  if (new Set(sectionIds).size !== sectionIds.length || new Set(diagramIds).size !== diagramIds.length) throw new Error('修复位置重复');
  if (sectionIds.some((id) => !lesson.sections.some((s) => s.id === id)) || diagramIds.some((id) => !lesson.diagrams.some((d) => d.sectionId === id))) throw new Error('修复只能替换已有内容');
  if (sectionScope && [...sectionIds, ...diagramIds].some((id) => id !== sectionScope)) throw new Error('修复超出局部修订范围');
  return Lesson.parse({ ...lesson,
    sections: lesson.sections.map((s) => patch.sections.find((p) => p.id === s.id) ?? s),
    diagrams: lesson.diagrams.map((d) => patch.diagrams.find((p) => p.sectionId === d.sectionId) ?? d),
  });
}
