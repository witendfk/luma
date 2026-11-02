import { defineStore } from 'pinia';
import { onScopeDispose, ref } from 'vue';
import * as api from '@/api/conversations';
import type { StreamEvent, TurnRequest } from '@luma/shared';
import { openTurnStream, type TurnStreamHandle } from '@/utils/sse';
import { onSessionCleared, sessionVersion } from '@/utils/token';

export const useConversationStore = defineStore('conversation', () => {
  const currentId = ref<string | null>(null);
  const title = ref('');
  const messages = ref<Array<{ id: string; role: 'user' | 'assistant'; text: string; incomplete?: boolean }>>([]);
  const subject = ref<api.SubjectView | null>(null);
  const artifacts = ref<api.ConversationDetail['artifacts']>([]);
  const generating = ref(false);
  const waitingJob = ref(false);
  const error = ref('');
  const currentRunId = ref<string | null>(null);
  let streamHandle: TurnStreamHandle | null = null;
  let openVersion = 0;
  let messageVersion = 0;
  let polling: ReturnType<typeof setTimeout> | undefined;

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
    stopStream();
    currentId.value = null;
    currentRunId.value = null;
    title.value = '';
    messages.value = [];
    subject.value = null;
    artifacts.value = [];
    waitingJob.value = false;
    error.value = '';
  }
  onScopeDispose(onSessionCleared(reset));

  async function refresh(includeMessages = true): Promise<void> {
    const id = currentId.value;
    if (!id) return;
    const version = openVersion, session = sessionVersion(), revision = messageVersion;
    const [detail, history] = await Promise.all([api.getConversation(id), includeMessages ? api.listMessages(id) : Promise.resolve(null)]);
    if (version !== openVersion || session !== sessionVersion() || id !== currentId.value) return;
    title.value = detail.conversation.title;
    subject.value = detail.subject;
    artifacts.value = detail.artifacts;
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

  async function send(text: string, action?: TurnRequest['action'], subjectType: 'question' | 'knowledge' = 'question'): Promise<void> {
    if (generating.value || (!text.trim() && !action)) return;
    const version = openVersion, session = sessionVersion();
    messageVersion += 1;
    generating.value = true;
    error.value = '';
    try {
      if (!currentId.value) {
        const created = await api.createConversation({ initialText: text, subjectType });
        if (version !== openVersion || session !== sessionVersion()) return;
        currentId.value = created.id;
        title.value = created.title;
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
        body: { requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text, action, expectedRevision: subject.value?.version },
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
    if (!currentId.value || !subject.value || generating.value) return;
    const version = openVersion, session = sessionVersion();
    await api.confirmSubject(currentId.value, subject.value.version);
    if (version !== openVersion || session !== sessionVersion()) return;
    await refresh(false);
    if (version !== openVersion || session !== sessionVersion()) return;
    await send('题目已核对，请先给我一个思考方向');
  }

  async function stop(): Promise<void> {
    const runId = currentRunId.value;
    stopStream();
    waitingJob.value = false;
    currentRunId.value = null;
    if (runId) await api.cancelRun(runId);
    await refresh();
  }

  return { currentId, currentRunId, title, messages, subject, artifacts, generating, waitingJob, error,
    reset, open, refresh, send, confirm, stop, appendLocalMessage, setStream, stopStream };
});
