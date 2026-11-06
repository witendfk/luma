import { Prisma, type Message } from '@prisma/client';
import { z } from 'zod';
import { db } from '../lib/db';
import { estimateTokens } from '../lib/token-budget';
import { textOf } from './blocks';
import type { TurnPolicy } from './policy';

export const MessageReadOptions = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  beforeMessageId: z.string().min(1).optional(),
  messageIds: z.array(z.string().min(1)).min(1).max(6).optional(),
  aroundMessageId: z.string().min(1).optional(),
  offset: z.number().int().min(0).max(1000000).optional(),
  limit: z.number().int().min(1).max(10).default(5),
}).superRefine((v, ctx) => {
  if ([v.query, v.messageIds, v.aroundMessageId].filter(Boolean).length > 1 || ((v.messageIds || v.aroundMessageId) && v.beforeMessageId) ||
    (v.offset && (!v.messageIds || v.messageIds.length !== 1))) ctx.addIssue({ code: 'custom', message: '搜索、精确、相邻回读不能混用；偏移只用于单条精确读取' });
});
export type MessageReadOptions = z.infer<typeof MessageReadOptions>;
export function normalizeHistoryQuery(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[−–]/g, '-').replace(/\\(?:left|right|,|;|!)/g, '').replace(/[\s${}^]/g, '');
}
interface ReadContext { userId: string; conversationId: string; policy: TurnPolicy; runId?: string }

/** All ownership/focus/answer filters run in PostgreSQL, before matching and ranking any text. */
async function rows(ctx: ReadContext, extra: Prisma.Sql, order: 'asc' | 'desc', take: number): Promise<Message[]> {
  const f = ctx.policy.focus;
  return db.$queryRaw<Message[]>(Prisma.sql`
    SELECT m.* FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId"
    WHERE c.id=${ctx.conversationId} AND c."userId"=${ctx.userId}
      AND m."subjectId"=${ctx.policy.subjectId} AND m."subjectRevisionId"=${ctx.policy.subjectRevisionId ?? ''}
      AND m.status='complete' AND m.role IN ('user','assistant')
      AND (${ctx.policy.allowSolution} OR COALESCE(m.content->>'containsSolution','false') <> 'true')
      AND (m.content->'focus'->>'artifactId') IS NOT DISTINCT FROM ${f.artifactId ?? null}
      AND (m.content->'focus'->>'artifactVersion') IS NOT DISTINCT FROM ${f.artifactVersion === undefined ? null : String(f.artifactVersion)}
      AND (m.content->'focus'->>'sectionId') IS NOT DISTINCT FROM ${f.sectionId ?? null}
      AND (m.content->'focus'->>'attemptId') IS NOT DISTINCT FROM ${f.attemptId ?? null}
      AND (m.content->'focus'->>'exerciseId') IS NOT DISTINCT FROM ${f.exerciseId ?? null}
      AND ${extra}
    ORDER BY m."createdAt" ${Prisma.raw(order)}, m.id ${Prisma.raw(order)} LIMIT ${take}`);
}
const before = (m: Pick<Message, 'id' | 'createdAt'>) => Prisma.sql`(m."createdAt",m.id)<(${m.createdAt},${m.id})`;
const after = (m: Pick<Message, 'id' | 'createdAt'>) => Prisma.sql`(m."createdAt",m.id)>(${m.createdAt},${m.id})`;

export function boundedRead(messages: Message[], offset = 0, budget = 6000) {
  const output: Array<{ id: string; role: string; at: Date; text: string; offset: number; complete: boolean }> = [];
  let nextRead: { messageId: string; offset: number } | null = null;
  let remaining = budget;
  for (const [index, message] of messages.entries()) {
    const original = textOf(message.content), start = index === 0 ? offset : 0;
    const text = original.slice(start);
    let end = text.length;
    if (estimateTokens(text) > remaining) {
      let low = 0, high = end;
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (estimateTokens(text.slice(0, mid)) <= remaining) low = mid; else high = mid - 1; }
      end = low;
      if (end && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
    }
    const chunk = text.slice(0, end);
    if (chunk) output.push({ id: message.id, role: message.role, at: message.createdAt, text: chunk, offset: start, complete: end === text.length });
    remaining -= estimateTokens(chunk);
    if (end < text.length) { nextRead = { messageId: message.id, offset: start + end }; break; }
    if (remaining < 64 && index < messages.length - 1) { nextRead = { messageId: messages[index + 1]!.id, offset: 0 }; break; }
  }
  return { messages: output, truncated: !!nextRead, nextRead, pendingMessageIds: messages.filter((m) => !output.some((o) => o.id === m.id)).map((m) => m.id) };
}

export async function readHistory(ctx: ReadContext, raw: unknown) {
  const parsed = MessageReadOptions.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: '消息读取参数冲突或超出限制' };
  const input = parsed.data;
  const boundary = ctx.runId ? await db.agentRun.findFirst({ where: { id: ctx.runId, conversationId: ctx.conversationId }, select: { userMessage: { select: { id: true, createdAt: true } } } }) : null;
  const guard = boundary?.userMessage ? before(boundary.userMessage) : Prisma.sql`TRUE`;
  const cursor = input.beforeMessageId ? (await rows(ctx, Prisma.sql`${guard} AND m.id=${input.beforeMessageId}`, 'asc', 1))[0] : null;
  if (input.beforeMessageId && !cursor) return { ok: false, code: 'INVALID_INPUT', message: '游标不属于当前可读范围' };
  if (input.query) {
    const needle = normalizeHistoryQuery(input.query);
    if (!needle) return { ok: false, code: 'INVALID_INPUT', message: '请输入可搜索的文字或数学符号' };
    const hits: Array<{ id: string; role: string; at: Date; snippet: string }> = [];
    let position = cursor, scanned = 0, hasMore = true;
    while (scanned < 1000 && hits.length < input.limit) {
      const page = await rows(ctx, Prisma.sql`${guard} AND ${position ? before(position) : Prisma.sql`TRUE`}`, 'desc', 100);
      for (const message of page) {
        position = message; scanned++;
        const text = textOf(message.content);
        if (normalizeHistoryQuery(text).includes(needle)) hits.push({ id: message.id, role: message.role, at: message.createdAt, snippet: text.slice(Math.max(0, normalizeHistoryQuery(text).indexOf(needle) - 120), Math.max(360, normalizeHistoryQuery(text).indexOf(needle) + 240)) });
        if (hits.length >= input.limit || scanned >= 1000) break;
      }
      hasMore = page.length === 100 || (page.length > 0 && position?.id !== page.at(-1)?.id);
      if (!hasMore) break;
    }
    return { ok: true, mode: 'search', query: input.query, hits, snippetsOnly: true, nextCursor: hasMore ? position?.id ?? null : null, scanned };
  }
  if (input.messageIds) {
    const exact = await rows(ctx, Prisma.sql`${guard} AND m.id IN (${Prisma.join(input.messageIds)})`, 'asc', 6);
    if (exact.length !== new Set(input.messageIds).size) return { ok: false, code: 'INVALID_INPUT', message: '引用不属于当前对象、焦点或解析权限' };
    if (input.offset && input.offset >= textOf(exact[0]!.content).length) return { ok: false, code: 'INVALID_INPUT', message: '读取偏移超出原文范围' };
    return { ok: true, mode: 'read', nextCursor: null, ...boundedRead(exact, input.offset) };
  }
  if (input.aroundMessageId) {
    const anchor = (await rows(ctx, Prisma.sql`${guard} AND m.id=${input.aroundMessageId}`, 'asc', 1))[0];
    if (!anchor) return { ok: false, code: 'INVALID_INPUT', message: '目标消息不在当前可读范围' };
    const earlier = anchor.role === 'user' ? [] : await rows(ctx, Prisma.sql`${guard} AND ${before(anchor)}`, 'desc', 50);
    const userIndex = earlier.findIndex((m) => m.role === 'user');
    if (anchor.role !== 'user' && userIndex < 0) return { ok: false, code: 'INVALID_INPUT', message: '该轮原文过长，请使用精确读取' };
    const start = earlier.slice(0, userIndex + 1).reverse();
    const later = await rows(ctx, Prisma.sql`${guard} AND ${after(anchor)}`, 'asc', 50);
    const nextUser = later.findIndex((m) => m.role === 'user');
    if (later.length === 50 && nextUser < 0) return { ok: false, code: 'INVALID_INPUT', message: '该轮原文过长，请按消息ID分次读取' };
    return { ok: true, mode: 'read', nextCursor: null, ...boundedRead([...start, anchor, ...later.slice(0, nextUser < 0 ? undefined : nextUser)]) };
  }
  const page = await rows(ctx, Prisma.sql`${guard} AND ${cursor ? before(cursor) : Prisma.sql`TRUE`}`, 'desc', input.limit + 1);
  const selected = page.slice(0, input.limit);
  return { ok: true, mode: 'read', nextCursor: page.length > input.limit ? selected.at(-1)!.id : null, ...boundedRead(selected.reverse()) };
}
