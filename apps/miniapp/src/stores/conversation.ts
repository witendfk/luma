import { defineStore } from 'pinia';
import { onScopeDispose, ref } from 'vue';
import * as api from '@/api/conversations';
import type { StreamEvent, TurnRequest, LearningSubjectView, ProgressView, TeachingReply, MaterialTaskView } from '@luma/shared';
import { retryJob } from '@/api/jobs';
import { openTurnStream, type TurnStreamHandle } from '@/utils/sse';
import { onSessionCleared, sessionVersion } from '@/utils/token';
import { useHistoryStore } from '@/stores/history';

export const useConversationStore = defineStore('conversation', () => {
  const currentId = ref<string | null>(null);
  const title = ref('');
  const archivedAt = ref<string | null>(null);
  const messages = ref<Array<{ id: string; role: 'user' | 'assistant'; text: string; reply?: TeachingReply; runId?: string | null; incomplete?: boolean }>>([]);
  const subject = ref<api.SubjectView | null>(null);
  const subjects = ref<LearningSubjectView[]>([]);
  const activeSubjectId = ref<string | null>(null);
  const progress = ref<ProgressView | null>(null);
  const learningRoute = ref<import('@luma/shared').LearningRouteView | null>(null);
  const updatingRoute = ref(false);
  const learnAll = ref(false);
  const switchingSubject = ref(false);
  const artifacts = ref<api.ConversationDetail['artifacts']>([]);
  const lessonJob = ref<api.ConversationDetail['lessonJob']>(null);
  const materialTasks = ref<MaterialTaskView[]>([]);
  const retryingJobId = ref<string | null>(null);
  const generating = ref(false);
  const stopping = ref(false);
  const reconnecting = ref(false);
  const needsReconnect = ref(false);
  const editingSubject = ref(false);
  const confirmingSubject = ref(false);
  const stage = ref('clarifying');
  const waitingJob = ref(false);
  const error = ref('');
  const retryRunId = ref<string | null>(null);
  let lastTurn: TurnRequest | null = null;
  const currentRunId = ref<string | null>(null);
  let streamHandle: TurnStreamHandle | null = null;
  let openVersion = 0;
  let turnVersion = 0;
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
    reconnecting.value = false;
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
    currentRunId.value = null; retryRunId.value = null; lastTurn = null;
    title.value = '';
    archivedAt.value = null;
    messages.value = [];
    subject.value = null;
    learningRoute.value = null; updatingRoute.value = false;
    subjects.value = []; activeSubjectId.value = null; progress.value = null; learnAll.value = false; switchingSubject.value = false;
    artifacts.value = [];
    lessonJob.value = null;
    materialTasks.value = []; retryingJobId.value = null;
    editingSubject.value = false;
    confirmingSubject.value = false;
    stage.value = 'clarifying';
    waitingJob.value = false;
    stopping.value = false;
    reconnecting.value = false; needsReconnect.value = false;
    error.value = '';
  }
  onScopeDispose(onSessionCleared(reset));

  async function refresh(includeMessages = true): Promise<void> {
    const id = currentId.value;
    if (!id) return;
    const version = openVersion, session = sessionVersion(), revision = messageVersion, subjectSnapshot = subjectVersion;
    const detail = await api.getConversation(id);
    if (version !== openVersion || session !== sessionVersion() || id !== currentId.value || subjectSnapshot !== subjectVersion || revision !== messageVersion) return;
    const history = includeMessages ? await api.listMessages(id, undefined, detail.conversation.activeSubjectId ?? undefined) : null;
    if (version !== openVersion || session !== sessionVersion() || id !== currentId.value || subjectSnapshot !== subjectVersion || revision !== messageVersion) return;
    title.value = detail.conversation.title;
    archivedAt.value = detail.conversation.archivedAt;
    if (detail.conversation.id === id) useHistoryStore().applySummary(detail.conversation);
    subject.value = detail.subject;
    subjects.value = detail.subjects ?? [];
    activeSubjectId.value = detail.conversation.activeSubjectId ?? detail.subject?.subjectId ?? null;
    applyLearningRoute(detail.learningRoute ?? null);
    progress.value = detail.progress; learnAll.value = detail.conversation.learnAll ?? false;
    artifacts.value = detail.artifacts;
    lessonJob.value = detail.lessonJob ?? null;
    materialTasks.value = detail.materialTasks ?? [];
    stage.value = detail.progress?.stage ?? 'clarifying';
    if (detail.activeRun && !generating.value) {
      waitingJob.value = true;
      currentRunId.value = detail.activeRun.id;
      clearTimeout(polling);
      pollRun(detail.activeRun.id, version, session);
    }
    if (!detail.activeRun && !generating.value && detail.latestRun) {
      waitingJob.value = false; currentRunId.value = null;
      const failed = ['failed', 'cancelled'].includes(detail.latestRun.status);
      retryRunId.value = failed ? detail.latestRun.id : null;
      if (failed) error.value = detail.latestRun.error?.message ?? (detail.latestRun.status === 'cancelled' ? '本次回复已停止' : '生成失败，请重试');
      else error.value = '';
    }
    needsReconnect.value = false;
    const local = messages.value;
    if (history && revision === messageVersion) messages.value = history.items.map((message) => ({
      id: message.id, runId: message.runId, role: message.role, incomplete: message.status === 'incomplete',
      reply: (message.content as { reply?: TeachingReply }).reply,
      text: ((message.content as { blocks?: Array<{ type: string; text?: string }> }).blocks ?? [])
        .filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n'),
    })).map((message) => {
      const partial = !generating.value && message.incomplete && local.find((m) => m.incomplete && m.runId === message.runId && m.role === message.role);
      return partial && partial.text.length > message.text.length && partial.text.startsWith(message.text) ? { ...message, text: partial.text } : message;
    });
  }

  async function open(id: string): Promise<void> {
    reset();
    currentId.value = id;
    await refresh();
  }

  function appendLocalMessage(msg: { role: 'user' | 'assistant'; text: string; runId?: string }): void {
    messages.value.push({ id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ...msg });
  }

  function pollRun(runId: string, version: number, session: number): void {
    clearTimeout(polling);
    polling = setTimeout(async () => {
      if (openVersion !== version || sessionVersion() !== session || currentRunId.value !== runId) return;
      try {
        const run = await api.getRun(runId);
        if (openVersion !== version || sessionVersion() !== session || currentRunId.value !== runId) return;
        if (['running', 'waiting_job'].includes(run.status)) {
          await refresh(run.status === 'running');
          return;
        }
        waitingJob.value = false;
        if (run.status === 'failed') error.value = run.error?.message ?? '生成失败，请重试';
        await refresh();
      } catch (err) {
        if (openVersion === version && sessionVersion() === session && currentRunId.value === runId) {
          needsReconnect.value = true;
          error.value = '连接中断，已保留当前内容；请重新连接核对结果';
        }
      }
    }, 1500);
  }

  async function reconnect(): Promise<void> {
    if (reconnecting.value || stopping.value || !currentId.value) return;
    const version = openVersion, session = sessionVersion(), turn = turnVersion;
    reconnecting.value = true;
    needsReconnect.value = true;
    generating.value = false;
    try {
      // Read persisted state only. Never resend the turn or start another model call.
      await refresh();
      if (version === openVersion && session === sessionVersion() && turn === turnVersion) needsReconnect.value = false;
    } catch {
      if (version === openVersion && session === sessionVersion() && turn === turnVersion) {
        error.value = '暂时无法核对回复状态，已有内容保留；请重新连接';
      }
    } finally {
      if (version === openVersion && session === sessionVersion() && turn === turnVersion) reconnecting.value = false;
    }
  }

  async function send(text: string, action?: TurnRequest['action'], subjectType: 'question' | 'knowledge' = 'question', intent?: api.LearningIntent, retryInput?: Partial<TurnRequest>, focus?: Pick<TurnRequest, 'artifactId' | 'artifactVersion' | 'sectionId' | 'attemptId' | 'exerciseId' | 'practiceMode'>): Promise<void> {
    if (generating.value || waitingJob.value || reconnecting.value || needsReconnect.value || updatingRoute.value || stopping.value || editingSubject.value || switchingSubject.value || (!text.trim() && !action && !retryInput?.retryOfRunId)) return;
    const version = openVersion, session = sessionVersion(), turn = ++turnVersion;
    messageVersion += 1;
    generating.value = true;
    error.value = '';
    try {
      if (!currentId.value) {
        const created = await api.createConversation({ initialText: text, subjectType, intent });
        if (version !== openVersion || session !== sessionVersion() || turn !== turnVersion) return;
        currentId.value = created.id;
        title.value = created.title;
        archivedAt.value = created.archivedAt;
        await refresh(false);
        if (version !== openVersion || session !== sessionVersion() || turn !== turnVersion) return;
      }

      clearTimeout(polling);
      waitingJob.value = false;
      if (!retryInput) appendLocalMessage({ role: 'user', text });
      const handleEvent = (event: StreamEvent) => {
        if (version !== openVersion || session !== sessionVersion() || turn !== turnVersion) return;
        if (event.type === 'run.started') {
          currentRunId.value = event.runId;
          const last = messages.value[messages.value.length - 1];
          if (last?.role === 'user' && !last.runId) last.runId = event.runId;
        }
        if (event.type === 'route.updated') applyLearningRoute(event.route);
        if (event.type === 'text.reset') {
          const last = messages.value[messages.value.length - 1];
          if (last?.role === 'assistant' && last.runId === event.runId && last.incomplete) messages.value.pop();
        }
        if (event.type === 'text.delta') {
          const last = messages.value[messages.value.length - 1];
          if (last?.role === 'assistant' && last.runId === event.runId && last.incomplete) last.text += event.delta;
          else { appendLocalMessage({ role: 'assistant', text: event.delta, runId: event.runId }); messages.value[messages.value.length - 1]!.incomplete = true; }
        }
        if (event.type === 'run.completed' || event.type === 'run.waiting') {
          const last = messages.value[messages.value.length - 1];
          if (last?.role === 'assistant' && last.runId === event.runId) last.incomplete = false;
          generating.value = false;
          waitingJob.value = event.type === 'run.waiting' && event.waiting === 'job';
          if (waitingJob.value) pollRun(event.runId, version, session);
          else currentRunId.value = null;
        }
        if (event.type === 'run.failed' || event.type === 'run.cancelled') {
          generating.value = false;
          retryRunId.value = event.runId; currentRunId.value = null;
          if (event.type === 'run.failed') error.value = event.error.message;
        }
      };
      lastTurn = { requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text, action,
        subjectId: activeSubjectId.value ?? undefined, expectedRevision: subject.value?.version, ...focus, ...retryInput };
      setStream(openTurnStream({
        conversationId: currentId.value!,
        body: lastTurn,
        onEvent: handleEvent,
        onDone: () => {
          if (version !== openVersion || session !== sessionVersion() || turn !== turnVersion) return;
          generating.value = false;
          void refresh().catch((err) => { if (version === openVersion && session === sessionVersion() && turn === turnVersion) error.value = err.message; });
        },
        onError: (message) => {
          if (version !== openVersion || session !== sessionVersion() || turn !== turnVersion) return;
          generating.value = false;
          error.value = message;
          void reconnect();
        },
      }));
    } catch (err) {
      if (version === openVersion && session === sessionVersion() && turn === turnVersion) {
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
      else await send('内容已核对，请继续解答我原来的问题');
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
      learningRoute.value = null;
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
      learningRoute.value = detail.learningRoute ?? null;
      activeSubjectId.value = detail.conversation.activeSubjectId ?? null; progress.value = detail.progress;
      learnAll.value = detail.conversation.learnAll ?? false; stage.value = detail.progress?.stage ?? 'clarifying';
      artifacts.value = detail.artifacts; messages.value = []; error.value = ''; currentRunId.value = null; retryRunId.value = null; lastTurn = null;
      await refresh();
    } finally {
      if (session === sessionVersion() && currentId.value === id && openVersion === version) switchingSubject.value = false;
    }
  }

  async function retry(): Promise<void> {
    if (generating.value || waitingJob.value || !currentId.value) return;
    if (retryRunId.value) await send('', undefined, 'question', undefined, { retryOfRunId: retryRunId.value });
    else if (lastTurn) await send(lastTurn.text ?? '', lastTurn.action, 'question', undefined, lastTurn);
  }

  async function stop(): Promise<void> {
    if (stopping.value) return;
    const version = ++openVersion, session = sessionVersion();
    stopping.value = true;
    const runId = currentRunId.value;
    stopStream();
    waitingJob.value = false;
    currentRunId.value = null;
    try {
      if (runId) await api.cancelRun(runId);
      if (version === openVersion && session === sessionVersion()) await refresh();
    } catch (err) {
      // Cancellation may have succeeded before the response was lost. Reconcile; never auto-regenerate.
      if (version === openVersion && session === sessionVersion()) {
        await refresh().catch(() => {});
        throw err;
      }
    } finally { if (version === openVersion && session === sessionVersion()) stopping.value = false; }
  }

  async function retryMaterial(jobId: string): Promise<void> {
    if (retryingJobId.value || generating.value || waitingJob.value || stopping.value) return;
    const id = currentId.value, version = openVersion, session = sessionVersion();
    retryingJobId.value = jobId;
    try {
      await retryJob(jobId);
      if (id === currentId.value && version === openVersion && session === sessionVersion()) await refresh();
    } finally {
      if (version === openVersion && session === sessionVersion()) retryingJobId.value = null;
    }
  }

  function applyLearningRoute(next: import('@luma/shared').LearningRouteView | null): void {
    if (next && next.subjectRevisionId !== subject.value?.id) return;
    if (learningRoute.value && learningRoute.value.subjectRevisionId !== subject.value?.id) learningRoute.value = null;
    if (!next && learningRoute.value?.subjectRevisionId === subject.value?.id) return;
    if (next && learningRoute.value?.id === next.id && learningRoute.value.version > next.version) return;
    if (next && learningRoute.value && learningRoute.value.id !== next.id &&
      (learningRoute.value.createdAt > next.createdAt || (learningRoute.value.createdAt === next.createdAt && learningRoute.value.id > next.id))) return;
    learningRoute.value = next;
  }

  async function actOnRoute(action: 'pause' | 'resume' | 'skip' | 'revisit', nodeId?: string): Promise<void> {
    const route = learningRoute.value, id = currentId.value, object = activeSubjectId.value;
    if (!route || !id || !object || updatingRoute.value || generating.value || waitingJob.value || stopping.value || switchingSubject.value || editingSubject.value) return;
    const version = openVersion, session = sessionVersion();
    updatingRoute.value = true;
    try {
      const next = await api.updateLearningRoute(id, object, { requestId: `route_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        routeId: route.id, expectedVersion: route.version, action, nodeId });
      if (version === openVersion && session === sessionVersion() && activeSubjectId.value === object) applyLearningRoute(next);
    } catch (err) {
      if (version === openVersion && session === sessionVersion() && activeSubjectId.value === object) await refresh(false).catch(() => {});
      throw err;
    } finally { if (version === openVersion && session === sessionVersion()) updatingRoute.value = false; }
  }

  return { reconnect, reconnecting, needsReconnect, learningRoute, updatingRoute, actOnRoute, retry, retryMaterial, retryingJobId, materialTasks, retryRunId, lessonJob, subjects, activeSubjectId, progress, learnAll, switchingSubject, saveDraft, switchSubject, currentId, currentRunId, title, archivedAt, messages, subject, artifacts, generating, editingSubject, confirmingSubject, stage, waitingJob, error,
    stopping, reset, open, refresh, send, confirm, editSubject, stop, appendLocalMessage, setStream, stopStream, applySummary };
});
