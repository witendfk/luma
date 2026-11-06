import { createHash } from 'node:crypto';
import { Prisma, type TeachingMemory as StoredMemory } from '@prisma/client';
import { z } from 'zod';
import { db } from '../lib/db';
import { estimateTokens } from '../lib/token-budget';
import { textOf } from './blocks';
import type { TurnPolicy } from './policy';

export const MemoryOperation = z.object({
  action: z.enum(['add', 'resolve', 'supersede', 'conflict']),
  kind: z.enum(['constraint', 'request', 'difficulty', 'method', 'attempt', 'open_question']),
  text: z.string().trim().min(1).max(600).optional(),
  targetId: z.string().min(1).optional(), expectedVersion: z.number().int().positive().optional(),
  source: z.enum(['student', 'assistant']), quote: z.string().trim().min(1).max(600),
}).superRefine((op, ctx) => {
  if (op.action === 'add' && (op.targetId || op.expectedVersion)) ctx.addIssue({ code: 'custom', message: '新增不能携带状态变更目标' });
  if (op.action !== 'resolve' && !op.text) ctx.addIssue({ code: 'custom', message: '新增或更正记录需要text' });
  if (op.action !== 'add' && (!op.targetId || !op.expectedVersion)) ctx.addIssue({ code: 'custom', message: '状态变更需要条目ID和版本' });
  if (op.action !== 'add' && op.source !== 'student') ctx.addIssue({ code: 'custom', message: '解决、更正或冲突需要学生原话' });
});
export type MemoryOperation = z.infer<typeof MemoryOperation>;
type Focus = TurnPolicy['focus'];
export function memoryScopeKey(focus: Focus): string {
  return createHash('sha256').update(JSON.stringify(['artifactId', 'artifactVersion', 'sectionId', 'attemptId', 'exerciseId'].map((k) => focus[k as keyof Focus] ?? null))).digest('hex');
}
export function memoryVisible(note: Pick<StoredMemory, 'scope' | 'kind' | 'containsSolution' | 'status'>, policy: TurnPolicy): boolean {
  if (!['candidate', 'active', 'conflicted'].includes(note.status) || (note.containsSolution && !policy.allowSolution)) return false;
  const focus = (note.scope ?? {}) as Focus;
  const generic = !Object.values(focus).some((v) => v !== undefined && v !== null);
  if (generic) return !policy.focus.attemptId || note.kind === 'request';
  return memoryScopeKey(focus) === memoryScopeKey(policy.focus);
}
export function memoryStatus(kind: string, source: 'student' | 'assistant', action: string): string {
  if (action === 'conflict' || kind === 'constraint') return 'conflicted';
  // A student's attempted calculation is evidence of a try, never a verified fact.
  return source === 'student' && kind !== 'attempt' ? 'active' : 'candidate';
}
export class TeachingMemoryCapacityError extends Error {}

export async function evidencePack(input: { userId: string; conversationId: string; policy: TurnPolicy }, tx: Prisma.TransactionClient = db) {
  const revision = input.policy.subjectRevisionId ? await tx.subjectRevision.findFirst({ where: { id: input.policy.subjectRevisionId,
    subjectId: input.policy.subjectId, conversationId: input.conversationId, conversation: { userId: input.userId } } }) : null;
  if (!revision) return null;
  const all = await tx.teachingMemory.findMany({ where: { subjectRevisionId: revision.id, status: { in: ['candidate', 'active', 'conflicted'] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const items = all.filter((note) => memoryVisible(note, input.policy)).map((note) => ({ id: note.id, version: note.version, kind: note.kind,
    text: note.text, status: note.status, sourceKind: note.sourceKind, evidence: note.evidence, scope: note.scope,
    containsSolution: note.containsSolution, verificationRef: note.verificationRef }));
  const pack = { schemaVersion: 1, subjectId: revision.subjectId, subjectRevisionId: revision.id, subjectVersion: revision.version,
    focus: input.policy.focus, allowSolution: input.policy.allowSolution, items };
  if (estimateTokens(pack) > 12000) throw new TeachingMemoryCapacityError('当前有效教学记录超出装配预算，原记录已保留，请缩小本次学习范围');
  return pack;
}

/** Called only inside the run-guarded transaction. Invalid candidates are audited, not silently promoted. */
export async function applyTeachingMemory(tx: Prisma.TransactionClient, input: {
  revisionId: string; userMessageId: string; messageId: string; policy: TurnPolicy; operations: MemoryOperation[];
}) {
  const sources = await tx.message.findMany({ where: { id: { in: [input.userMessageId, input.messageId] }, subjectRevisionId: input.revisionId, status: 'complete' } });
  const scope = JSON.parse(JSON.stringify(input.policy.focus)) as Prisma.InputJsonValue;
  const scopeKey = memoryScopeKey(input.policy.focus);
  const accepted: string[] = [], rejected: Array<{ index: number; code: string }> = [];
  for (const [index, operation] of input.operations.entries()) {
    const parsed = MemoryOperation.safeParse(operation);
    if (!parsed.success) { rejected.push({ index, code: 'INVALID_MEMORY' }); continue; }
    const op = parsed.data;
    const source = sources.find((m) => m.id === (op.source === 'student' ? input.userMessageId : input.messageId) && m.role === (op.source === 'student' ? 'user' : 'assistant'));
    if (!source || !textOf(source.content).includes(op.quote)) { rejected.push({ index, code: 'EVIDENCE_MISMATCH' }); continue; }
    const target = op.action !== 'add' && op.targetId ? await tx.teachingMemory.findFirst({ where: { id: op.targetId, subjectRevisionId: input.revisionId } }) : null;
    if (op.action !== 'add' && (!target || target.version !== op.expectedVersion || target.kind !== op.kind ||
      memoryScopeKey(target.scope as Focus) !== scopeKey || !memoryVisible(target, input.policy) || !['active', 'candidate', 'conflicted'].includes(target.status))) {
      rejected.push({ index, code: 'MEMORY_CONFLICT' }); continue;
    }
    // Condition changes never modify a confirmed SubjectRevision; they remain a conflict for confirmation.
    const status = memoryStatus(op.kind, op.source, op.action);
    const evidence = [{ messageId: source.id, quote: op.quote, role: source.role }];
    if (target) {
      const changed = await tx.teachingMemory.updateMany({ where: { id: target.id, version: op.expectedVersion }, data: {
        status: op.action === 'resolve' ? 'resolved' : status === 'conflicted' ? 'conflicted' : 'superseded', version: { increment: 1 },
      } });
      if (changed.count !== 1) { rejected.push({ index, code: 'MEMORY_CONFLICT' }); continue; }
      if (op.action === 'resolve') {
        // Resolution evidence remains alongside the original evidence.
        await tx.teachingMemory.update({ where: { id: target.id }, data: { evidence: [...(target.evidence as Prisma.JsonArray), ...evidence] } });
        accepted.push(target.id); continue;
      }
    }
    const id = 'memory:' + createHash('sha256').update(JSON.stringify([input.revisionId, scopeKey, op.kind, op.text, evidence, op.targetId ?? null])).digest('hex').slice(0, 40);
    await tx.teachingMemory.upsert({ where: { id }, update: {}, create: { id, subjectRevisionId: input.revisionId, scope, scopeKey,
      kind: op.kind, text: op.text!, sourceKind: op.source === 'student' ? 'student_statement' : 'model_inference', evidence, status,
      supersedesId: target?.id, containsSolution: op.source === 'assistant' && input.policy.allowSolution } });
    accepted.push(id);
  }
  return { accepted, rejected };
}
