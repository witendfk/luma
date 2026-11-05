import { defineStore } from 'pinia';
import { onScopeDispose, ref } from 'vue';
import * as api from '@/api/conversations';
import type { StreamEvent, TurnRequest, LearningSubjectView, ProgressView } from '@luma/shared';
import { openTurnStream, type TurnStreamHandle } from '@/utils/sse';
import { onSessionCleared, sessionVersion } from '@/utils/token';
import { useHistoryStore } from '@/stores/history';

export const useConversationStore = defineStore('conversation', () => {
  const currentId = ref<string | null>(null);
  const title = ref('');
  const archivedAt = ref<string | null>(null);
  const messages = ref<Array<{ id: string; role: 'user' | 'assistant'; text: string; incomplete?: boolean }>>([]);
  const subject = ref<api.SubjectView | null>(null);
  const subjects = ref<LearningSubjectView[]>([]);
  const activeSubjectId = ref<string | null>(null);
  const progress = ref<ProgressView | null>(null);
  const learnAll = ref(false);
  const switchingSubject = ref(false);
  const artifacts = ref<api.ConversationDetail['artifacts']>([]);
  const generating = ref(false);
  const editingSubject = ref(false);
  const confirmingSubject = ref(false);
  const stage = ref('clarifying');
  const waitingJob = ref(false);
  const error = ref('');
  const currentRunId = ref<string | null>(null);
  let streamHandle: TurnStreamHandle | null = null;
  let openVersion = 0;
  let messageVersion = 0;
  let subjectVersion = 0;
  let polling: ReturnType<typeof setTimeout> | undefined;

  function applySummary(item: api.ConversationSummary): void {
    if (item.id !== currentId.value) return;
    title.value = item.title;
    archivedAt.value = item.archivedAt;
  }

  function stopStream(): void {
    streamHandle?.abort();
    streamHandle = null;
    clearTimeout(polling);
    generating.value = false;
  }

  function setStream(handle: TurnStreamHandle): void {
    streamHandle?.abort();
    streamHandle = handle;
  }

  function reset(): void {
    openVersion += 1;
    subjectVersion += 1;
    stopStream();
    currentId.value = null;
    currentRunId.value = null;
    title.value = '';
    archivedAt.value = null;
    messages.value = [];
    subject.value = null;
    subjects.value = []; activeSubjectId.value = null; progress.value = null; learnAll.value = false; switchingSubject.value = false;
    artifacts.value = [];
    editingSubject.value = false;
    confirmingSubject.value = false;
    stage.value = 'clarifying';
    waitingJob.value = false;
    error.value = '';
  }
  onScopeDispose(onSessionCleared(reset));

  async function refresh(includeMessages = true): Promise<void> {
    const id = currentId.value;
    if (!id) return;
    const version = openVersion, session = sessionVersion(), revision = messageVersion, subjectSnapshot = subjectVersion;
    const detail = await api.getConversation(id);
    if (version !== openVersion || session !== sessionVersion() || id !== currentId.value || subjectSnapshot !== subjectVersion) return;
    const history = includeMessages ? await api.listMessages(id, undefined, detail.conversation.activeSubjectId ?? undefined) : null;
    if (version !== openVersion || session !== sessionVersion() || id !== currentId.value || subjectSnapshot !== subjectVersion) return;
    title.value = detail.conversation.title;
    archivedAt.value = detail.conversation.archivedAt;
    if (detail.conversation.id === id) useHistoryStore().applySummary(detail.conversation);
    subject.value = detail.subject;
    subjects.value = detail.subjects ?? [];
    activeSubjectId.value = detail.conversation.activeSubjectId ?? detail.subject?.subjectId ?? null;
    progress.value = detail.progress; learnAll.value = detail.conversation.learnAll ?? false;
    artifacts.value = detail.artifacts;
    stage.value = detail.progress?.stage ?? 'clarifying';
    if (detail.activeRun && !generating.value) {
      waitingJob.value = true;
      currentRunId.value = detail.activeRun.id;
      clearTimeout(polling);
      pollRun(detail.activeRun.id, version, session);
    }
    if (history && revision === messageVersion) messages.value = history.items.map((message) => ({
      id: message.id, role: message.role, incomplete: message.status === 'incomplete',
      text: ((message.content as { blocks?: Array<{ type: string; text?: string }> }).blocks ?? [])
        .filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n'),
    }));
  }

  async function open(id: string): Promise<void> {
    reset();
    currentId.value = id;
    await refresh();
  }

  function appendLocalMessage(msg: { role: 'user' | 'assistant'; text: string }): void {
    messages.value.push({ id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ...msg });
  }

  function pollRun(runId: string, version: number, session: number): void {
    polling = setTimeout(async () => {
      if (openVersion !== version || sessionVersion() !== session || currentRunId.value !== runId) return;
      try {
        const run = await api.getRun(runId);
        if (openVersion !== version || sessionVersion() !== session || currentRunId.value !== runId) return;
        if (['running', 'waiting_job'].includes(run.status)) {
          pollRun(runId, version, session);
          return;
        }
        waitingJob.value = false;
        currentRunId.value = null;
        if (run.status === 'failed') error.value = run.error?.message ?? '生成失败，请重试';
        await refresh();
      } catch (err) {
        if (openVersion === version && sessionVersion() === session) error.value = err instanceof Error ? err.message : '状态获取失败';
      }
    }, 1500);
  }

  async function send(text: string, action?: TurnRequest['action'], subjectType: 'question' | 'knowledge' = 'question', intent?: api.LearningIntent): Promise<void> {
    if (generating.value || editingSubject.value || switchingSubject.value || (!text.trim() && !action)) return;
    const version = openVersion, session = sessionVersion();
    messageVersion += 1;
    generating.value = true;
    error.value = '';
    try {
      if (!currentId.value) {
        const created = await api.createConversation({ initialText: text, subjectType, intent });
        if (version !== openVersion || session !== sessionVersion()) return;
        currentId.value = created.id;
        title.value = created.title;
        archivedAt.value = created.archivedAt;
        await refresh(false);
        if (version !== openVersion || session !== sessionVersion()) return;
      }

      clearTimeout(polling);
      waitingJob.value = false;
      appendLocalMessage({ role: 'user', text });
      const handleEvent = (event: StreamEvent) => {
        if (version !== openVersion || session !== sessionVersion()) return;
        if (event.type === 'run.started') currentRunId.value = event.runId;
        if (event.type === 'text.delta') {
          const last = messages.value[messages.value.length - 1];
          if (last?.role === 'assistant' && last.incomplete) last.text += event.delta;
          else { appendLocalMessage({ role: 'assistant', text: event.delta }); messages.value[messages.value.length - 1]!.incomplete = true; }
        }
        if (event.type === 'run.completed' || event.type === 'run.waiting') {
          const last = messages.value[messages.value.length - 1];
          if (last?.role === 'assistant') last.incomplete = false;
          generating.value = false;
          waitingJob.value = event.type === 'run.waiting' && event.waiting === 'job';
          if (waitingJob.value) pollRun(event.runId, version, session);
          else currentRunId.value = null;
        }
        if (event.type === 'run.failed' || event.type === 'run.cancelled') {
          generating.value = false;
          currentRunId.value = null;
          if (event.type === 'run.failed') error.value = event.error.message;
        }
      };
      setStream(openTurnStream({
        conversationId: currentId.value!,
        body: { requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text, action, subjectId: activeSubjectId.value ?? undefined, expectedRevision: subject.value?.version },
        onEvent: handleEvent,
        onDone: () => {
          if (version !== openVersion || session !== sessionVersion()) return;
          generating.value = false;
          void refresh().catch((err) => { if (version === openVersion && session === sessionVersion()) error.value = err.message; });
        },
        onError: (message) => {
          if (version !== openVersion || session !== sessionVersion()) return;
          generating.value = false;
          error.value = message;
        },
      }));
    } catch (err) {
      if (version === openVersion && session === sessionVersion()) {
        generating.value = false;
        error.value = err instanceof Error ? err.message : '发送失败';
      }
    }
  }

  async function confirm(): Promise<void> {
    if (!currentId.value || !subject.value || subject.value.confirmedAt || generating.value || editingSubject.value || confirmingSubject.value || switchingSubject.value) return;
    const version = openVersion, session = sessionVersion();
    confirmingSubject.value = true;
    subjectVersion += 1;
    try {
      await api.confirmSubject(currentId.value, subject.value.version, activeSubjectId.value ?? undefined);
      if (version !== openVersion || session !== sessionVersion()) return;
      await refresh(false);
      if (version !== openVersion || session !== sessionVersion()) return;
      const intent = subject.value?.content.intent ?? subject.value?.type;
      if (intent === 'practice') await send('范围已核对，请生成同知识点练习', 'generate_practice');
      else if (intent === 'knowledge') await send('范围已核对，请生成图文讲解', 'generate_lesson');
      else await send('题目已核对，请先给我一个思考方向');
    } finally {
      if (version === openVersion && session === sessionVersion()) confirmingSubject.value = false;
    }
  }

  async function editSubject(input: api.SubjectEdit): Promise<boolean> {
    if (!currentId.value || generating.value || confirmingSubject.value || editingSubject.value || switchingSubject.value) return false;
    const id = currentId.value, version = openVersion, session = sessionVersion();
    editingSubject.value = true;
    subjectVersion += 1;
    try {
      const result = await api.updateSubject(id, input, activeSubjectId.value ?? undefined);
      if (version !== openVersion || session !== sessionVersion() || id !== currentId.value) return false;
      stopStream();
      messageVersion += 1;
      waitingJob.value = false;
      currentRunId.value = null;
      subject.value = result.subject;
      if (result.progress) progress.value = result.progress;
      subjects.value = subjects.value.map((row) => row.id === activeSubjectId.value ? { ...row, revision: result.subject, progress: result.progress ?? row.progress } : row);
      stage.value = 'clarifying';
      error.value = '';
      return true;
    } finally {
      if (version === openVersion && session === sessionVersion()) editingSubject.value = false;
    }
  }

  async function saveDraft(draft: string): Promise<void> {
    if (!currentId.value || !activeSubjectId.value || !subject.value || !progress.value) return;
    const id = currentId.value, objectId = activeSubjectId.value, snapshot = progress.value, session = sessionVersion();
    if (draft === snapshot.draft) return;
    const result = await api.saveProgress(id, objectId, {
      expectedRevision: subject.value.version, expectedVersion: snapshot.version,
      destination: snapshot.destination, draft,
      artifactId: snapshot.currentArtifactId ?? undefined, sectionId: snapshot.currentSectionId ?? undefined,
      attemptId: snapshot.currentAttemptId ?? undefined, exerciseId: snapshot.currentExerciseId ?? undefined,
    });
    if (session === sessionVersion() && currentId.value === id && activeSubjectId.value === objectId && progress.value === snapshot) progress.value = result;
  }

  async function switchSubject(subjectId: string, draft: string, all?: boolean): Promise<void> {
    if (!currentId.value || generating.value || waitingJob.value || editingSubject.value || confirmingSubject.value || switchingSubject.value) return;
    const id = currentId.value, session = sessionVersion();
    let version = openVersion;
    switchingSubject.value = true;
    try {
      await saveDraft(draft);
      if (session !== sessionVersion() || currentId.value !== id || version !== openVersion) return;
      const detail = await api.focusSubject(id, subjectId, all);
      if (session !== sessionVersion() || currentId.value !== id || version !== openVersion) return;
      openVersion += 1; version = openVersion; messageVersion += 1; stopStream();
      subject.value = detail.subject; subjects.value = detail.subjects;
      activeSubjectId.value = detail.conversation.activeSubjectId ?? null; progress.value = detail.progress;
      learnAll.value = detail.conversation.learnAll ?? false; stage.value = detail.progress?.stage ?? 'clarifying';
      artifacts.value = detail.artifacts; messages.value = []; error.value = ''; currentRunId.value = null;
      await refresh();
    } finally {
      if (session === sessionVersion() && currentId.value === id && openVersion === version) switchingSubject.value = false;
    }
  }

  async function stop(): Promise<void> {
    const runId = currentRunId.value;
    stopStream();
    waitingJob.value = false;
    currentRunId.value = null;
    if (runId) await api.cancelRun(runId);
    await refresh();
  }

  return { subjects, activeSubjectId, progress, learnAll, switchingSubject, saveDraft, switchSubject, currentId, currentRunId, title, archivedAt, messages, subject, artifacts, generating, editingSubject, confirmingSubject, stage, waitingJob, error,
    reset, open, refresh, send, confirm, editSubject, stop, appendLocalMessage, setStream, stopStream, applySummary };
});
