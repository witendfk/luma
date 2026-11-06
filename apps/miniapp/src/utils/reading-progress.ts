import type { ProgressView } from '@luma/shared';
import { getConversation, saveProgress } from '@/api/conversations';

/** Coalesce scroll events; never send overlapping progress versions or replay after account changes. */
export function readingProgress(input: { conversationId: string; subjectId: string; revisionId: string; revision: number; artifactId: string;
  initial: ProgressView; isCurrent: () => boolean }) {
  let progress = input.initial, desired = '', saved = progress.currentArtifactId === input.artifactId ? progress.currentSectionId ?? '' : '';
  let pending: Promise<void> | undefined;
  async function flush(): Promise<void> {
    if (pending) { await pending; if (desired !== saved && input.isCurrent()) return flush(); return; }
    if (!desired || desired === saved || !input.isCurrent()) return;
    pending = (async () => {
      while (input.isCurrent() && desired !== saved) {
        const sectionId = desired;
        try {
          const result = await saveProgress(input.conversationId, input.subjectId, { expectedRevision: input.revision,
            expectedVersion: progress.version, destination: 'reader', artifactId: input.artifactId, sectionId });
          if (!input.isCurrent()) return;
          progress = result; saved = sectionId;
        } catch (err) {
          if ((err as { failure?: { code?: string } }).failure?.code !== 'REVISION_CONFLICT' || !input.isCurrent()) throw err;
          const detail = await getConversation(input.conversationId);
          if (!input.isCurrent()) return;
          const subject = detail.subjects.find((s) => s.id === input.subjectId);
          if (subject?.revision?.id !== input.revisionId || !subject.progress) throw new Error('题目已修改，请打开新版讲解');
          progress = subject.progress;
          // One bounded retry; preserve unrelated draft fields by omitting them from the request.
          const result = await saveProgress(input.conversationId, input.subjectId, { expectedRevision: input.revision,
            expectedVersion: progress.version, destination: 'reader', artifactId: input.artifactId, sectionId });
          if (!input.isCurrent()) return;
          progress = result; saved = sectionId;
        }
      }
    })();
    try { await pending; } finally { pending = undefined; }
  }
  return { remember(section: string) { desired = section; }, flush };
}
