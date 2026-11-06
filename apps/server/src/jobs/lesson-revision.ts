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
