import { studyExample } from '@/fixtures/study';
import type { RequestOptions } from '@/utils/request';
import type { TurnStreamOptions, TurnStreamHandle } from '@/utils/sse';
import { getToken, sessionVersion } from '@/utils/token';

export const MOCK_TOKEN = 'luma-ui-preview-only';
const KEY = 'luma_ui_preview:workspace:v1';
export interface PreviewRecord {
  id: string; title: string; text: string; type: 'question' | 'knowledge'; tags: string[];
  version?: number; confirmedAt?: string | null; intent?: string;
  archivedAt: string | null; lastActiveAt: string; collected: boolean; note: string;
  reviewStatus: 'to_review' | 'reviewed'; lesson: boolean; practice: boolean;
  messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }>;
}
const seed = (): PreviewRecord[] => [
  { id: 'preview-quadratic', title: '配方法：为什么要加上再减去？', text: studyExample.subject, type: 'question', tags: ['二次函数', '配方法'], archivedAt: null, lastActiveAt: '2026-11-03T08:00:00Z', collected: true, note: '先凑完全平方，再检查常数有没有改变。', reviewStatus: 'to_review', lesson: true, practice: true, messages: [{ id: 'u1', role: 'user', text: studyExample.subject }, { id: 'a1', role: 'assistant', text: '先观察 x² − 2x。它与哪个完全平方展开式最接近？图文讲解与两道配套练习已准备好，可以按自己的节奏继续。' }] },
  { id: 'preview-sets', title: '交集和并集，条件到底怎么读？', text: '为什么交集对应“并且”，并集对应“或者”？', type: 'knowledge', tags: ['集合', '交集与并集'], archivedAt: null, lastActiveAt: '2026-11-02T08:00:00Z', collected: true, note: '', reviewStatus: 'reviewed', lesson: false, practice: false, messages: [{ id: 'u2', role: 'user', text: '为什么交集对应“并且”？' }, { id: 'a2', role: 'assistant', text: '先想一个同时满足两个条件的例子：既喜欢数学，又喜欢物理的同学，会出现在两个集合的哪里？' }] },
  { id: 'preview-archive', title: '函数最小值和 x 的取值有什么区别？', text: '函数最小值和 x 的取值有什么区别？', type: 'knowledge', tags: ['函数'], archivedAt: '2026-11-01T08:00:00Z', lastActiveAt: '2026-11-01T08:00:00Z', collected: false, note: '', reviewStatus: 'to_review', lesson: false, practice: false, messages: [{ id: 'u3', role: 'user', text: '最小的是 x 还是函数值？' }, { id: 'a3', role: 'assistant', text: '输入的是 x，输出的是 f(x)。我们比较曲线高度时，比较的是哪个量？' }] },
];
let rows: PreviewRecord[] | undefined;
function data(): PreviewRecord[] {
  if (!rows) {
    try { const saved = uni.getStorageSync(KEY); if (saved) rows = JSON.parse(String(saved)); } catch { /* 使用示例初值。 */ }
    if (!Array.isArray(rows) || !rows.every((r) => typeof r.id === 'string' && Array.isArray(r.messages))) rows = seed();
  }
  return rows;
}
function persist(): void { uni.setStorageSync(KEY, JSON.stringify(data())); }
export function previewRecords(): PreviewRecord[] { return JSON.parse(JSON.stringify(data())); }
export function editPreview(id: string, patch: Partial<Pick<PreviewRecord, 'collected' | 'note' | 'reviewStatus'>>): void { const row = find(id), previous = { ...row };
  Object.assign(row, patch);
  try { persist(); } catch { Object.assign(row, previous); throw new Error('本机保存失败，请重试'); } }
function find(id: string): PreviewRecord { const row = data().find((r) => r.id === id); if (!row) throw new Error('这条示例记录已不存在'); return row; }
const summary = (r: PreviewRecord) => ({ id: r.id, title: r.title, archivedAt: r.archivedAt, lastActiveAt: r.lastActiveAt });
const subject = (r: PreviewRecord) => ({ id: `${r.id}-subject-v${r.version ?? 1}`, version: r.version ?? 1, type: r.type, content: { text: r.text, intent: r.intent }, tags: r.tags, confirmedAt: r.confirmedAt === undefined ? '2026-11-01T08:00:00Z' : r.confirmedAt });

/** 开发预览的传输替身：不执行网络请求，未覆盖的请求明确报错，不回退真实接口。 */
export async function mockRequest<T>(opts: RequestOptions): Promise<T> {
  if (opts.path !== '/api/auth/wechat/login' && getToken() !== MOCK_TOKEN) throw new Error('请先登录前端预览身份');
  const [path, query = ''] = opts.path.split('?');
  const params: Record<string, string> = {};
  query.split('&').filter(Boolean).forEach((part) => { const [k, v = ''] = part.split('='); params[k!] = decodeURIComponent(v); });
  const body = (opts.data ?? {}) as Record<string, any>;
  let result: unknown;
  if (path === '/api/auth/wechat/login') result = { userId: 'ui-preview', token: MOCK_TOKEN, expiresAt: '2099-01-01T00:00:00Z' };
  else if (path === '/api/auth/me') result = { id: 'ui-preview', nickname: '同学', avatarUrl: null, createdAt: '2026-11-01T00:00:00Z' };
  else if (path === '/api/auth/logout') result = { loggedOut: true };
  else if (path === '/api/conversations' && opts.method === 'GET') result = { items: data().filter((r) => Boolean(r.archivedAt) === (params.archived === '1')).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)).map(summary), nextCursor: null };
  else if (path === '/api/conversations' && opts.method === 'POST') {
    const row: PreviewRecord = { ...seed()[1]!, id: `preview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: (body.title || body.initialText || '新的学习对话').slice(0, 60), text: body.initialText || '', type: body.subjectType || 'question', collected: false, note: '', lesson: false, practice: false, reviewStatus: 'to_review', version: 1, confirmedAt: null, intent: body.intent, tags: [], lastActiveAt: new Date().toISOString(), messages: [] };
    data().unshift(row); persist(); result = summary(row);
  } else {
    const match = path!.match(/^\/api\/conversations\/([^/]+)(?:\/(messages|subjects))?$/);
    const collection = path!.match(/^\/api\/collections\/([^/]+)$/);
    if (match) {
      const row = find(decodeURIComponent(match[1]!));
      if (match[2] === 'subjects') {
        if (body.expectedRevision !== (row.version ?? 1)) throw new Error('内容已更新，请重新打开');
        if (body.action === 'confirm') row.confirmedAt = new Date().toISOString();
        else { row.text = body.content?.text ?? row.text; row.version = (row.version ?? 1) + 1; row.confirmedAt = null; row.tags = []; row.lesson = false; row.practice = false; }
        persist(); result = { subject: subject(row) };
      } else if (match[2] === 'messages') result = { items: row.messages.map((m) => ({ id: m.id, role: m.role, content: { blocks: [{ type: 'text', text: m.text }] }, status: 'complete', createdAt: row.lastActiveAt })), nextCursor: null };
      else if (opts.method === 'PUT') {
        if (body.title !== undefined) { if (!body.title.trim() || body.title.length > 60) throw new Error('名称须为 1–60 个字'); row.title = body.title.trim(); }
        if (body.archived !== undefined) row.archivedAt = body.archived ? new Date().toISOString() : null;
        row.lastActiveAt = new Date().toISOString(); persist(); result = summary(row);
      } else result = { conversation: summary(row), subject: subject(row), progress: { stage: row.confirmedAt === null ? 'clarifying' : 'guiding' }, artifacts: [
        ...(row.lesson ? [{ id: 'preview-lesson', type: 'lesson', publishStatus: 'published', subjectRevisionId: subject(row).id }] : []),
        ...(row.practice ? [{ id: 'preview-practice', type: 'exercise_set', publishStatus: 'published', subjectRevisionId: subject(row).id }] : []),
      ] };
    } else if (collection) {
      editPreview(decodeURIComponent(collection[1]!), opts.method === 'DELETE' ? { collected: false } : { collected: true, ...body }); result = {};
    } else throw new Error('此操作尚未提供前端示例，未调用真实服务');
  }
  return JSON.parse(JSON.stringify(result)) as T;
}
export function mockTurn(opts: TurnStreamOptions): TurnStreamHandle {
  const token = getToken(), session = sessionVersion();
  const timer = setTimeout(() => {
    if (getToken() !== token || sessionVersion() !== session) return;
    try {
      if (token !== MOCK_TOKEN) throw new Error('请先登录前端预览身份');
      const row = find(opts.conversationId);
      const text = String(opts.body.text ?? '');
      const reply = opts.body.action === 'generate_lesson' || opts.body.action === 'generate_practice'
        ? '（前端示例回复）当前不生成新的教学内容。你可以从最近学习中的配方法示例，完整体验图文讲解和配套练习。'
        : row.confirmedAt === null ? '（前端示例回复）先确认一下题目内容，尤其是条件和符号。核对后再继续思考。'
        : '（前端示例回复）先把你已经知道的条件写下来。你觉得下一步可以从哪一个关系入手？';
      row.messages.push({ id: `u-${Date.now()}`, role: 'user', text }, { id: `a-${Date.now()}`, role: 'assistant', text: reply });
      row.lastActiveAt = new Date().toISOString(); persist();
      opts.onEvent({ type: 'text.delta', runId: 'preview-run', delta: reply });
      opts.onEvent({ type: 'run.completed', runId: 'preview-run' }); opts.onDone();
    } catch (err) { opts.onError(err instanceof Error ? err.message : '示例交互失败'); }
  }, 220);
  return { abort: () => clearTimeout(timer) };
}
