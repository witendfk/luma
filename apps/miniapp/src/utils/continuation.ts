import { studyExamples } from '@/fixtures/study';
import { previewRecords, previewRoot } from '@/mocks/workspace';
import { studyPreviewStorageKey } from '@/stores/study-preview';

export interface Continuation { url: string; label: string; notice?: string }
/** 只读取当前记录，不创建练习轮次，不改变当前题或揭示答案。 */
export function previewContinuation(id: string): Continuation {
  const root = previewRoot(id);
  const fallback: Continuation = { url: `/pages/chat/index?id=${encodeURIComponent(root?.id ?? id)}`, label: '继续对话' };
  if (!root || root.archivedAt || !root.resume) return fallback;
  const saved = root.resume;
  const topic = previewRecords().find((item) => item.id === saved.scope && (item.id === root.id || item.parentId === root.id));
  if (!topic) return { ...fallback, notice: '上次学习内容已变化，已回到对话' };
  fallback.url += `&topic=${encodeURIComponent(topic.id)}`;
  const fixture = studyExamples[topic.exampleKey ?? (topic.id === 'preview-quadratic' ? 'quadratic' : '')];
  if (saved.view === 'chat') return { ...fallback, label: topic.confirmedAt === null ? '继续核对内容' : '继续对话' };
  if (!fixture || (topic.version ?? 1) !== saved.revision || topic.confirmedAt === null || (saved.view === 'reader' ? !topic.lesson : !topic.practice)) {
    return { ...fallback, notice: '上次的材料已变化，先回对话确认内容' };
  }
  let data: any;
  try { data = JSON.parse(String(uni.getStorageSync(studyPreviewStorageKey(topic.id)) || '{}')); }
  catch { return { ...fallback, notice: '上次的位置暂时无法恢复，已回到对话' }; }
  const url = `/pages/${saved.view}/index?preview=1&scope=${encodeURIComponent(topic.id)}`;
  if (saved.view === 'reader') {
    const section = fixture.sections.find((item) => item.id === data.sectionId);
    return section ? { url, label: `继续阅读 · ${section.heading}` } : { ...fallback, notice: '阅读位置已变化，已回到对话' };
  }
  const round = data.round;
  if (!round || !['intro', 'doing', 'review', 'summary'].includes(round.phase) || !Array.isArray(round.ids) || !round.ids.length || new Set(round.ids).size !== round.ids.length || !Number.isInteger(round.index) || round.index < 0 || round.index >= round.ids.length || !round.ids.every((qid: string) => fixture.exercises.some((item) => item.id === qid) && typeof round.answers?.[qid]?.text === 'string' && typeof round.answers[qid].unknown === 'boolean' && typeof round.answers[qid].hint === 'boolean' && (round.answers[qid].rating === null || ['independent', 'partial', 'stuck'].includes(round.answers[qid].rating))) || (round.phase === 'summary' && round.ids.some((qid: string) => !round.answers[qid].rating))) {
    return { ...fallback, notice: '上次的练习位置暂时无法恢复，已回到对话' };
  }
  return { url, label: round.phase === 'doing' ? `继续作答 · 第 ${round.index + 1} / ${round.ids.length} 题` : round.phase === 'review' ? '继续对照自评' : round.phase === 'summary' ? '回看本轮练习反馈' : '开始配套练习' };
}
