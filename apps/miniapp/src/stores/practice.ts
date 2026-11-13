import { computed, onScopeDispose, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AttemptAnswerView, AttemptView, AttemptHistoryItem, PracticeRedoMode, ExerciseView, ProgressView, SelfEval } from '@luma/shared';
import * as api from '@/api/practice';
import { getConversation, saveProgress } from '@/api/conversations';
import { request } from '@/utils/request';
import { onSessionCleared } from '@/utils/token';
import { chooseAttachments, type LocalAttachment } from '@/utils/attachments';
import { uploadAttachments } from '@/api/uploads';

interface PracticeMaterial {
  id: string; type: string; publishStatus: string; version: number; conversationId: string;
  subjectId: string; subjectRevisionId: string; subjectVersion: number; attemptId: string | null; exercises: ExerciseView[];
}
const blank = (): AttemptAnswerView => ({ textDraft: '', photoIds: [], markedUnknown: false, hintsUsed: 0, solutionViewedAt: null, selfEval: null, draftVersion: 0 });
type CachedDraft = { baseVersion: number; textDraft: string; photoIds?: string[]; markedUnknown: boolean; selfEval: SelfEval | null };
const snapshot = (answer: AttemptAnswerView): CachedDraft => ({ baseVersion: answer.draftVersion, textDraft: answer.textDraft ?? '', photoIds: [...answer.photoIds], markedUnknown: answer.markedUnknown, selfEval: answer.selfEval });
const sameDraft = (a: CachedDraft, b: CachedDraft) => a.textDraft === b.textDraft && JSON.stringify(a.photoIds ?? []) === JSON.stringify(b.photoIds ?? []) && a.markedUnknown === b.markedUnknown && a.selfEval === b.selfEval;

/** 正式练习状态。页面只展示真实题组；未保存草稿保留本机，写请求严格串行。 */
export const usePracticeStore = defineStore('practice', () => {
  const material = ref<PracticeMaterial | null>(null), attempt = ref<AttemptView | null>(null);
  const loading = ref(false), busy = ref(false), saving = ref(false), error = ref(''), saveError = ref('');
  const index = ref(0), dirty = ref<string[]>([]), history = ref<AttemptHistoryItem[]>([]);
  const isHistorical = computed(() => Boolean(attempt.value && history.value[0] && attempt.value.id !== history.value[0].id));
  const roundNumber = computed(() => history.value.length - history.value.findIndex((item) => item.id === attempt.value?.id));
  let epoch = 0, timer: ReturnType<typeof setTimeout> | undefined, pending: Promise<void> | undefined;
  let progress: ProgressView | null = null;
  const conflicts = ref<Record<string, CachedDraft>>({});
  const photoDrafts = ref<Record<string, LocalAttachment[]>>({});
  const pendingPhotos = computed(() => photoDrafts.value[current.value?.id ?? ''] ?? []);
  const exercises = computed(() => attempt.value?.exercises ?? material.value?.exercises ?? []);
  const current = computed(() => attempt.value?.exercises[index.value]);
  const stage = computed(() => attempt.value?.stage ?? 'intro');
  const answered = computed(() => attempt.value?.exercises.filter((ex) => ex.myAnswer?.textDraft?.trim() || ex.myAnswer?.photoIds.length || ex.myAnswer?.markedUnknown).length ?? 0);
  const rated = computed(() => attempt.value?.exercises.filter((ex) => ex.myAnswer?.selfEval).length ?? 0);
  const independent = computed(() => attempt.value?.exercises.filter((ex) => ex.myAnswer?.selfEval === 'independent').length ?? 0);
  const needsPractice = computed(() => attempt.value?.exercises.filter((ex) => ex.myAnswer?.selfEval !== 'independent') ?? []);
  const usedHelp = computed(() => attempt.value?.exercises.some((ex) => (ex.myAnswer?.hintsUsed ?? 0) > 0 || ex.myAnswer?.solutionViewedAt) ?? false);
  const cacheKey = () => `luma_draft:practice:${attempt.value?.id}`;
  const photoKey = () => `luma_draft:practice-photos:${attempt.value?.id}`;
  function persistPhotos(): void {
    try { uni.setStorageSync(photoKey(), photoDrafts.value); }
    catch { saveError.value = '作答照片草稿未能保存在本机，请先同步再离开'; }
  }
  function persist(): void {
    if (!attempt.value) return;
    try {
      if (!dirty.value.length && !Object.keys(conflicts.value).length) uni.removeStorageSync(cacheKey());
      else uni.setStorageSync(cacheKey(), JSON.stringify({ ...conflicts.value, ...Object.fromEntries(attempt.value.exercises.filter((ex) => dirty.value.includes(ex.id) && !conflicts.value[ex.id]).map((ex) => [ex.id, snapshot(ex.myAnswer!)])) }));
    } catch { saveError.value = '本机草稿未能保存，请先同步再离开'; }
  }
  function restoreDrafts(): void {
    if (!attempt.value || stage.value === 'summary' || isHistorical.value) return;
    try {
      const raw = uni.getStorageSync(cacheKey());
      if (!raw) return;
      const cache = JSON.parse(String(raw)) as Record<string, CachedDraft>;
      for (const ex of attempt.value.exercises) {
        const local = cache[ex.id];
        if (!local || typeof local.textDraft !== 'string' || local.textDraft.length > 8000 || typeof local.markedUnknown !== 'boolean' || ![null, 'independent', 'partial', 'stuck'].includes(local.selfEval)) continue;
        const answer = ex.myAnswer ?? blank();
        if (sameDraft(local, snapshot(answer))) continue;
        if (local.baseVersion !== answer.draftVersion) { conflicts.value[ex.id] = local; saveError.value = '服务端作答已更新，本机未同步草稿已保留，请核对后再修改'; continue; }
        ex.myAnswer = { ...answer, ...(stage.value === 'doing' ? { textDraft: local.textDraft, photoIds: local.photoIds ?? answer.photoIds, markedUnknown: local.markedUnknown } : { selfEval: local.selfEval }) };
        dirty.value.push(ex.id);
      }
    } catch { saveError.value = '本机草稿读取失败，请核对当前作答'; }
  }
  function reset(): void { epoch++; clearTimeout(timer); material.value = null; attempt.value = null; history.value = []; dirty.value = []; conflicts.value = {}; photoDrafts.value = {}; progress = null; pending = undefined; loading.value = busy.value = saving.value = false; error.value = saveError.value = ''; index.value = 0; }
  onScopeDispose(onSessionCleared(reset));
  async function open(artifactId: string, attemptId?: string): Promise<void> {
    if (attempt.value && dirty.value.length) await flush();
    reset(); const version = epoch; loading.value = true;
    try {
      const doc = await request<PracticeMaterial>({ method: 'GET', path: `/api/artifacts/${encodeURIComponent(artifactId)}` });
      if (version !== epoch) return;
      if (doc.type !== 'exercise_set' || doc.publishStatus !== 'published' || !doc.exercises.length) throw new Error('这份练习尚未发布');
      material.value = doc;
      const [detail, rounds] = await Promise.all([getConversation(doc.conversationId), api.listAttempts(doc.id)]);
      const loaded = attemptId || rounds[0]?.id ? await api.getAttempt(attemptId ?? rounds[0]!.id) : null;
      if (version !== epoch) return;
      if (loaded && loaded.artifactId !== doc.id) throw new Error('练习轮次与题组不匹配');
      history.value = rounds;
      progress = detail.subjects.find((s) => s.id === doc.subjectId)?.progress ?? null;
      attempt.value = loaded;
      if (loaded) { index.value = Math.max(0, loaded.exercises.findIndex((ex) => ex.id === loaded.currentExerciseId)); restoreDrafts();
        if (loaded.stage === 'doing') photoDrafts.value = uni.getStorageSync(photoKey()) || {};
      }
    } catch (err) { if (version === epoch) error.value = err instanceof Error ? err.message : '练习加载失败'; }
    finally { if (version === epoch) loading.value = false; }
  }
  async function start(): Promise<void> {
    if (!material.value || busy.value) return;
    const version = epoch; busy.value = true; error.value = '';
    try { const loaded = await api.startAttempt(material.value.id); const rounds = await api.listAttempts(material.value.id); if (version !== epoch) return; activate(loaded, rounds); await remember().catch((err) => { saveError.value = err instanceof Error ? err.message : '作答已打开，位置稍后同步'; }); }
    catch (err) { if (version === epoch) error.value = err instanceof Error ? err.message : '无法开始练习'; }
    finally { if (version === epoch) busy.value = false; }
  }
  function edit(patch: { textDraft?: string; photoIds?: string[]; markedUnknown?: boolean }, id = current.value?.id): void {
    if (!attempt.value || stage.value !== 'doing' || isHistorical.value || !id || busy.value) return;
    const ex = attempt.value.exercises.find((e) => e.id === id); if (!ex) return;
    ex.myAnswer = { ...(ex.myAnswer ?? blank()), ...patch };
    markDirty(id);
  }
  function recoverDraft(): void {
    const id = current.value?.id, local = id ? conflicts.value[id] : undefined;
    if (!id || !local || !current.value || isHistorical.value || stage.value === 'summary' || busy.value) return;
    current.value.myAnswer = { ...(current.value.myAnswer ?? blank()), ...(stage.value === 'doing' ? { textDraft: local.textDraft, photoIds: local.photoIds ?? current.value.myAnswer?.photoIds ?? [], markedUnknown: local.markedUnknown } : { selfEval: local.selfEval }) };
    delete conflicts.value[id]; markDirty(id);
  }
  const hasConflict = computed(() => Boolean(current.value && conflicts.value[current.value.id]));
  function markDirty(id: string): void {
    if (!dirty.value.includes(id)) dirty.value.push(id);
    persist(); clearTimeout(timer); timer = setTimeout(() => { void flush().catch(() => { /* retry remains explicit */ }); }, 600);
  }
  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (pending) { await pending; if (dirty.value.length) return flush(); return; }
    if (!attempt.value || !dirty.value.length) return;
    const version = epoch, target = attempt.value; saving.value = true; saveError.value = '';
    pending = (async () => {
      while (dirty.value.length && version === epoch) {
        const id = dirty.value[0]!, ex = target.exercises.find((e) => e.id === id)!;
        const sent = snapshot(ex.myAnswer!), nextVersion = sent.baseVersion + 1;
        const input = target.stage === 'doing' ? { textDraft: sent.textDraft, photoIds: sent.photoIds, markedUnknown: sent.markedUnknown, draftVersion: nextVersion } : { selfEval: sent.selfEval!, draftVersion: nextVersion };
        const saved = await api.saveAnswer(target.id, id, input);
        if (version !== epoch) return;
        const unchanged = sameDraft(sent, snapshot(ex.myAnswer!));
        ex.myAnswer!.draftVersion = saved.draftVersion;
        if (unchanged) dirty.value = dirty.value.filter((key) => key !== id);
        persist();
      }
    })();
    try { await pending; }
    catch (err) { if (version === epoch) { saveError.value = err instanceof Error ? err.message : '同步失败，本机草稿已保留'; persist(); } throw err; }
    finally { if (version === epoch) { pending = undefined; saving.value = false; } }
  }
  /** Uploads and answer writes share the round/question binding; selection alone never invokes GPT. */
  async function addPhotos(retry = false): Promise<void> {
    const doc = material.value, target = attempt.value, ex = current.value, version = epoch;
    if (!doc || !target || !ex || stage.value !== 'doing' || isHistorical.value || busy.value) return;
    busy.value = true;
    try {
      if (!retry) {
        if (pendingPhotos.value.length) throw new Error('请先上传或移除待上传照片');
        const capacity = 3 - (ex.myAnswer?.photoIds.length ?? 0);
        if (capacity <= 0) throw new Error('每题最多3张作答照片');
        const selected = await chooseAttachments(capacity);
        if (version !== epoch || !selected?.length) return;
        photoDrafts.value[ex.id] = selected; persistPhotos();
      }
      const images = photoDrafts.value[ex.id]; if (!images?.length) return;
      const ids = await uploadAttachments(images, 'answer_photo', { conversationId: doc.conversationId,
        subjectRevisionId: doc.subjectRevisionId, attemptId: target.id, exerciseId: ex.id });
      if (version !== epoch) return;
      ex.myAnswer = { ...(ex.myAnswer ?? blank()), photoIds: [...new Set([...(ex.myAnswer?.photoIds ?? []), ...ids])] };
      markDirty(ex.id); await flush();
      delete photoDrafts.value[ex.id]; persistPhotos();
    } finally { if (version === epoch) { busy.value = false; persistPhotos(); } }
  }
  function removePendingPhoto(index: number): void {
    if (busy.value || !current.value) return;
    photoDrafts.value[current.value.id]?.splice(index, 1); persistPhotos();
  }
  async function applyTranscript(text: string, mode: 'append' | 'replace', exerciseId: string): Promise<void> {
    if (stage.value !== 'doing' || isHistorical.value || busy.value || current.value?.id !== exerciseId) throw new Error('当前题目或作答状态已变化，请重新核对');
    const incoming = text.trim(), previous = current.value.myAnswer?.textDraft ?? '';
    if (!incoming) throw new Error('请先核对作答文字');
    const duplicate = previous.trim() === incoming || previous.trimEnd().endsWith(`\n${incoming}`);
    const merged = mode === 'replace' || !previous.trim() ? incoming : duplicate ? previous : `${previous.trimEnd()}\n${incoming}`;
    if (merged.length > 8000) throw new Error('合并后超过8000字，请精简转写或选择替换原内容');
    edit({ textDraft: merged }, exerciseId); await flush();
  }
  async function remember(): Promise<void> {
    if (!material.value || !attempt.value || !current.value || isHistorical.value || stage.value === 'summary') return;
    const version = epoch, doc = material.value, target = attempt.value, exerciseId = current.value.id;
    await api.savePosition(target.id, exerciseId);
    if (version !== epoch) return;
    if (!progress) return;
    const input = { expectedRevision: doc.subjectVersion, expectedVersion: progress.version, destination: 'practice' as const, artifactId: doc.id, attemptId: target.id, exerciseId };
    try { const saved = await saveProgress(doc.conversationId, doc.subjectId, input); if (version === epoch) progress = saved; }
    catch (err) {
      if ((err as { failure?: { code: string } }).failure?.code !== 'REVISION_CONFLICT' || version !== epoch) throw err;
      const detail = await getConversation(doc.conversationId); if (version !== epoch) return;
      const subject = detail.subjects.find((s) => s.id === doc.subjectId);
      if (subject?.revision?.id !== doc.subjectRevisionId || !subject.progress) throw new Error('学习内容已更新，当前练习作答仍已保留');
      const saved = await saveProgress(doc.conversationId, doc.subjectId, { ...input, expectedVersion: subject.progress.version }); if (version === epoch) progress = saved;
    }
  }
  async function jump(next: number): Promise<void> {
    if (busy.value || next < 0 || next >= exercises.value.length) return;
    const version = epoch; busy.value = true;
    try { await flush(); if (version !== epoch) return; index.value = next; if (attempt.value) { attempt.value.currentExerciseId = current.value?.id ?? null; await remember(); } }
    finally { if (version === epoch) busy.value = false; }
  }
  async function submit(): Promise<void> {
    if (!attempt.value || isHistorical.value || busy.value) return;
    if (Object.values(photoDrafts.value).some((images) => images.length)) throw new Error('还有待上传照片，请先上传或移除后再提交');
    busy.value = true; const version = epoch;
    try { await flush(); const loaded = await api.submitAttempt(attempt.value.id); if (version === epoch) attempt.value = loaded; }
    finally { if (version === epoch) busy.value = false; }
  }
  function rate(id: string, value: SelfEval): void {
    if (stage.value !== 'review' || isHistorical.value || busy.value) return;
    const ex = attempt.value?.exercises.find((e) => e.id === id); if (!ex) return;
    ex.myAnswer = { ...(ex.myAnswer ?? blank()), selfEval: value }; markDirty(id);
  }
  async function complete(): Promise<void> {
    if (!attempt.value || isHistorical.value || busy.value) return;
    busy.value = true; const version = epoch;
    try { await flush(); await api.completeAttempt(attempt.value.id); const loaded = await api.getAttempt(attempt.value.id); if (version === epoch) attempt.value = loaded; }
    finally { if (version === epoch) busy.value = false; }
  }
  function activate(loaded: AttemptView, rounds: AttemptHistoryItem[]): void {
    if (loaded.artifactId !== material.value?.id) throw new Error('练习轮次与题组不匹配');
    clearTimeout(timer); pending = undefined;
    attempt.value = loaded; history.value = rounds;
    index.value = Math.max(0, loaded.exercises.findIndex((ex) => ex.id === loaded.currentExerciseId));
    dirty.value = []; conflicts.value = {}; photoDrafts.value = {}; saveError.value = '';
    restoreDrafts();
    if (loaded.stage === 'doing' && !isHistorical.value) photoDrafts.value = uni.getStorageSync(photoKey()) || {};
  }
  async function refreshHistory(): Promise<void> {
    if (!material.value || busy.value) return;
    const version = epoch, rows = await api.listAttempts(material.value.id);
    if (version === epoch) history.value = rows;
  }
  async function switchAttempt(id: string): Promise<void> {
    if (!material.value || busy.value || id === attempt.value?.id) return;
    busy.value = true; const version = epoch;
    try {
      await flush();
      const [loaded, rounds] = await Promise.all([api.getAttempt(id), api.listAttempts(material.value.id)]);
      if (version !== epoch) return;
      if (rounds[0]?.id !== id && loaded.stage !== 'summary') throw new Error('该历史轮次尚未完成，请重新打开练习');
      activate(loaded, rounds);
    } finally { if (version === epoch) busy.value = false; }
  }
  async function redo(mode: PracticeRedoMode): Promise<void> {
    if (!attempt.value || !material.value || stage.value !== 'summary' || isHistorical.value || busy.value) return;
    busy.value = true; const version = epoch, sourceId = attempt.value.id;
    const key = `luma_draft:practice-redo:${sourceId}:${mode}`;
    try {
      await flush();
      // Persist before dispatch so response loss/re-entry can retry the same operation.
      let requestId = uni.getStorageSync(key) as string;
      if (!requestId) { requestId = `redo_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`; uni.setStorageSync(key, requestId); }
      const loaded = await api.redoAttempt(sourceId, mode, requestId);
      const rounds = await api.listAttempts(material.value.id);
      if (version !== epoch) return;
      activate(loaded, rounds); uni.removeStorageSync(key);
      await remember().catch((err) => { saveError.value = err instanceof Error ? err.message : '新轮已创建，位置稍后同步'; });
    } finally { if (version === epoch) busy.value = false; }
  }
  async function resume(): Promise<void> {
    if (!attempt.value || !material.value || busy.value || loading.value) return;
    busy.value = true; const version = epoch;
    try {
      await flush();
      const [loaded, rounds] = await Promise.all([api.getAttempt(attempt.value.id), api.listAttempts(material.value.id)]);
      if (version === epoch) activate(loaded, rounds);
    } finally { if (version === epoch) busy.value = false; }
  }
  return { material, attempt, loading, busy, saving, error, saveError, index, dirty, exercises, current, stage, answered, rated, independent, needsPractice, usedHelp,
    history, isHistorical, roundNumber, refreshHistory, switchAttempt, redo,
    pendingPhotos, photoDrafts, addPhotos, removePendingPhoto, applyTranscript, hasConflict, recoverDraft, open, start, edit, flush, remember, jump, submit, rate, complete, resume };
});
