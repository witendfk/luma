import { defineStore } from 'pinia';
import { onScopeDispose, ref } from 'vue';
import * as api from '@/api/conversations';
import type { TurnStreamHandle } from '@/utils/sse';
import { onSessionCleared, sessionVersion } from '@/utils/token';

/**
 * 当前会话状态（FR-10）：消息、生成中状态与流式句柄。
 * TODO(第一周)：历史恢复（题目确认状态、材料、作答进度）与重进续接（AC-16）。
 */
export const useConversationStore = defineStore('conversation', () => {
  const currentId = ref<string | null>(null);
  const title = ref('');
  const messages = ref<Array<{ id: string; role: 'user' | 'assistant'; text: string; incomplete?: boolean }>>([]);
  const generating = ref(false);
  let streamHandle: TurnStreamHandle | null = null;
  let openVersion = 0;

  function stopStream(): void {
    streamHandle?.abort();
    streamHandle = null;
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
    title.value = '';
    messages.value = [];
    generating.value = false;
  }

  onScopeDispose(onSessionCleared(reset));

  async function open(id: string): Promise<void> {
    const version = ++openVersion;
    const session = sessionVersion();
    stopStream();
    const detail = await api.getConversation(id);
    if (version !== openVersion || session !== sessionVersion()) return;
    currentId.value = id;
    title.value = detail.title;
    messages.value = [];
    // TODO(第一周)：GET /messages 分页拉取并渲染历史消息
  }

  function appendLocalMessage(msg: { role: 'user' | 'assistant'; text: string }): void {
    messages.value.push({ id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ...msg });
  }

  return { currentId, title, messages, generating, reset, open, appendLocalMessage, setStream, stopStream };
});
