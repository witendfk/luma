import { computed, onScopeDispose, ref } from 'vue';
import { defineStore } from 'pinia';
import { studyExample, type StudyRating } from '@/fixtures/study';
import { onSessionCleared } from '@/utils/token';

interface Answer { text: string; unknown: boolean; hint: boolean; rating: StudyRating | null }
interface Round { id: string; phase: 'intro' | 'doing' | 'review' | 'summary'; index: number; ids: string[]; answers: Record<string, Answer> }
export interface StudyFocus { kind: 'section' | 'exercise'; id: string; heading: string; question: string; roundId?: string }
const KEY = 'luma_draft:study-preview:v1';
const blank = (): Answer => ({ text: '', unknown: false, hint: false, rating: null });
const newRound = (ids = studyExample.exercises.map((item) => item.id)): Round => ({
  id: `preview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, phase: 'intro', index: 0, ids,
  answers: Object.fromEntries(ids.map((id) => [id, blank()])),
});

/** 只管理隔离的交互演示；不导入请求模块，不修改会话或正式练习。 */
export const useStudyPreviewStore = defineStore('study-preview', () => {
  const sectionId = ref(studyExample.sections[0]!.id);
  const round = ref<Round>(newRound());
  const history = ref<Round[]>([]);
  const focus = ref<StudyFocus | null>(null);
  const pendingQuestion = ref('');
  const messages = ref<Array<{ id: string; role: 'user' | 'assistant'; text: string }>>([]);
  const threads = new Map<string, { messages: typeof messages.value; draft: string }>();
  const focusKey = (target: StudyFocus) => `${target.kind}:${target.id}:${target.roundId ?? 'lesson-v1'}`;
  const loaded = ref(false);
  const savedLocally = ref(true);
  const currentExercise = computed(() => studyExample.exercises.find((item) => item.id === round.value.ids[round.value.index])!);
  const currentAnswer = computed(() => round.value.answers[currentExercise.value.id]!);
  const needsPractice = computed(() => round.value.ids.filter((id) => round.value.answers[id]!.rating !== 'independent'));
  const rated = computed(() => round.value.ids.filter((id) => Boolean(round.value.answers[id]!.rating)).length);

  function persist(): void {
    try { uni.setStorageSync(KEY, JSON.stringify({ sectionId: sectionId.value, round: round.value, history: history.value.slice(-6) })); savedLocally.value = true; }
    catch { savedLocally.value = false; }
  }
  function validRound(value: unknown): value is Round {
    const item = value as Round | null;
    return Boolean(item && typeof item.id === 'string' && ['intro', 'doing', 'review', 'summary'].includes(item.phase) &&
      Array.isArray(item.ids) && item.ids.length > 0 && item.ids.length <= studyExample.exercises.length && new Set(item.ids).size === item.ids.length &&
      Number.isInteger(item.index) && item.index >= 0 && item.index < item.ids.length && item.ids.every((id) => {
        const answer = item.answers?.[id];
        return studyExample.exercises.some((ex) => ex.id === id) && answer && typeof answer.text === 'string' && answer.text.length <= 4000 &&
          typeof answer.unknown === 'boolean' && typeof answer.hint === 'boolean' && (answer.rating === null || ['independent', 'partial', 'stuck'].includes(answer.rating));
      }) && (item.phase !== 'summary' || item.ids.every((id) => Boolean(item.answers[id]?.rating))));
  }
  function restore(): void {
    if (loaded.value) return;
    loaded.value = true;
    try {
      const raw = uni.getStorageSync(KEY);
      if (!raw) return;
      const data = JSON.parse(String(raw));
      if (studyExample.sections.some((section) => section.id === data.sectionId)) sectionId.value = data.sectionId;
      if (validRound(data.round)) round.value = data.round;
      if (Array.isArray(data.history)) history.value = data.history.filter(validRound).slice(-6);
    } catch { /* 损坏的演示缓存不阻断学习页面。 */ }
  }
  function selectSection(id: string): void {
    if (!studyExample.sections.some((section) => section.id === id)) return;
    sectionId.value = id; persist();
  }
  function start(): void { if (round.value.phase === 'intro') { round.value.phase = 'doing'; persist(); } }
  function jump(index: number): void { if (index >= 0 && index < round.value.ids.length) { round.value.index = index; persist(); } }
  function answer(text: string): void { if (round.value.phase === 'doing') { currentAnswer.value.text = text.slice(0, 4000); persist(); } }
  function markUnknown(): void { if (round.value.phase === 'doing') { currentAnswer.value.unknown = !currentAnswer.value.unknown; persist(); } }
  function toggleHint(): void { if (round.value.phase === 'doing') { currentAnswer.value.hint = !currentAnswer.value.hint; persist(); } }
  function submit(): void { if (round.value.phase === 'doing') { round.value.phase = 'review'; persist(); } }
  function rate(id: string, value: StudyRating): void {
    if (round.value.phase === 'review' && round.value.answers[id]) { round.value.answers[id]!.rating = value; persist(); }
  }
  function finish(): boolean {
    if (round.value.phase !== 'review' || rated.value !== round.value.ids.length) return false;
    round.value.phase = 'summary';
    history.value = [...history.value.filter((item) => item.id !== round.value.id), JSON.parse(JSON.stringify(round.value))].slice(-6);
    persist(); return true;
  }
  function restart(onlyNeeds: boolean): void {
    if (round.value.phase !== 'summary') return;
    const ids = onlyNeeds ? needsPractice.value : studyExample.exercises.map((item) => item.id);
    if (!ids.length) return;
    round.value = newRound([...ids]); round.value.phase = 'doing'; endFocus(); persist();
  }
  function ask(target: StudyFocus): void {
    if (focus.value) threads.set(focusKey(focus.value), { messages: messages.value, draft: pendingQuestion.value });
    focus.value = target;
    const prior = threads.get(focusKey(target));
    messages.value = prior?.messages ?? [];
    pendingQuestion.value = prior?.draft ?? (messages.value.length ? '' : target.question);
  }
  function send(text: string): void {
    const target = focus.value;
    if (!target || !text.trim()) return;
    let reply: string;
    if (target.kind === 'section') {
      const section = studyExample.sections.find((item) => item.id === target.id)!;
      reply = /例子/.test(text) ? section.example : section.detail;
    } else reply = studyExample.exercises.find((item) => item.id === target.id)!.hint;
    messages.value.push({ id: `u${messages.value.length}`, role: 'user', text },
      { id: `a${messages.value.length}`, role: 'assistant', text: `（示例回复）${reply}` });
    pendingQuestion.value = '';
    threads.set(focusKey(target), { messages: messages.value, draft: '' });
  }
  function discussionDraft(text: string): void { pendingQuestion.value = text; }
  function endFocus(): void {
    if (focus.value) threads.set(focusKey(focus.value), { messages: messages.value, draft: pendingQuestion.value });
    focus.value = null; pendingQuestion.value = ''; messages.value = [];
  }
  function clear(): void {
    sectionId.value = studyExample.sections[0]!.id; round.value = newRound(); history.value = [];
    endFocus(); threads.clear(); loaded.value = false; savedLocally.value = true;
  }
  onScopeDispose(onSessionCleared(clear));
  return { sectionId, round, history, focus, pendingQuestion, messages, savedLocally, currentExercise, currentAnswer, rated, needsPractice,
    restore, persist, selectSection, start, jump, answer, markUnknown, toggleHint, submit, rate, finish, restart, ask, send, discussionDraft, endFocus };
});
