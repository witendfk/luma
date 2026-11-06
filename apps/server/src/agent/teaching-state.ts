import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { TurnPolicy } from './policy';
import { applyTeachingMemory, MemoryOperation } from './teaching-memory';
import { textOf } from './blocks';

const Focus = z.object({ artifactId: z.string().optional(), sectionId: z.string().optional(), attemptId: z.string().optional(), exerciseId: z.string().optional() });
export const TeachingUpdate = z.object({
  operations: z.array(MemoryOperation).max(8).optional(),
  difficulty: z.string().trim().min(1).max(240).optional(),
  method: z.string().trim().min(1).max(240).optional(),
  openQuestion: z.string().trim().min(1).max(240).optional(),
  resolved: z.array(z.enum(['difficulty', 'openQuestion'])).max(2).optional(),
});
const Note = z.object({
  kind: z.enum(['difficulty', 'method', 'openQuestion']), text: z.string().max(500),
  source: z.enum(['model_inference', 'published_material']),
  messageId: z.string().optional(), userMessageId: z.string().optional(), artifactId: z.string().optional(),
  sectionId: z.string().optional(), focus: Focus, containsSolution: z.boolean(),
});
export const TeachingState = z.object({ version: z.number().int().min(0), notes: z.array(Note).max(12) });
export type TeachingState = z.infer<typeof TeachingState>;

export function stateFrom(raw: unknown): TeachingState {
  const parsed = TeachingState.safeParse(raw);
  return parsed.success ? parsed.data : { version: 0, notes: [] };
}

/** Facts never grant answer permission; attempt/section notes stay in their exact teaching scope. */
export function visibleTeachingState(raw: unknown, policy: TurnPolicy): TeachingState {
  const state = stateFrom(raw);
  return { ...state, notes: state.notes.filter((note) => {
    if (note.containsSolution && !policy.allowSolution) return false;
    if (note.focus.attemptId || policy.focus.attemptId) return note.focus.attemptId === policy.focus.attemptId && note.focus.exerciseId === policy.focus.exerciseId;
    if (note.focus.artifactId) return note.focus.artifactId === policy.focus.artifactId && (!note.focus.sectionId || note.focus.sectionId === policy.focus.sectionId);
    return true;
  }) };
}

export function mergeTeachingNotes(raw: unknown, notes: TeachingState['notes'], resolved?: { kinds: string[]; focus: TurnPolicy['focus'] }): TeachingState {
  const state = stateFrom(raw);
  let result = state.notes.filter((note) => !resolved || !resolved.kinds.includes(note.kind) || JSON.stringify(note.focus) !== JSON.stringify(resolved.focus));
  for (const note of notes) {
    result = result.filter((old) => !(old.kind === note.kind && JSON.stringify(old.focus) === JSON.stringify(note.focus)));
    result.push(note);
  }
  return TeachingState.parse({ version: state.version + 1, notes: result.slice(-12) });
}

/** Called inside the run's guarded conversation transaction, after a complete reply is saved. */
export async function saveTeachingUpdate(tx: Prisma.TransactionClient, input: {
  revisionId: string; userMessageId: string | null; messageId: string; policy: TurnPolicy; update?: z.infer<typeof TeachingUpdate>; candidates?: z.infer<typeof MemoryOperation>[];
}) {
  if ((!input.update && !input.candidates?.length) || !input.policy.subjectConfirmed || !input.userMessageId) return;
  const evidence = await tx.message.findFirst({ where: { id: input.userMessageId, subjectRevisionId: input.revisionId, status: 'complete', role: 'user' } });
  if (!evidence) return;
  const { resolved, operations, ...update } = TeachingUpdate.parse(input.update ?? {});
  const assistant = await tx.message.findUniqueOrThrow({ where: { id: input.messageId } });
  // Legacy metadata remains compatible, but cannot resolve an arbitrary same-kind record.
  const candidates = [...(input.candidates ?? []), ...(operations ?? Object.entries(update).map(([kind, text]) => ({ action: 'add' as const,
    kind: kind === 'openQuestion' ? 'open_question' as const : kind as 'difficulty' | 'method', text,
    source: 'assistant' as const, quote: textOf(assistant.content).slice(0, 600) })))];
  return applyTeachingMemory(tx, { ...input, userMessageId: input.userMessageId, operations: candidates });
}
