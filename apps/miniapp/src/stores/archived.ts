import { onScopeDispose, ref } from 'vue';
import { defineStore } from 'pinia';
import { listConversations, updateConversation, type ConversationSummary } from '@/api/conversations';
import { getToken, onSessionCleared, sessionVersion } from '@/utils/token';
import { useHistoryStore } from '@/stores/history';
import { useConversationStore } from '@/stores/conversation';

export const useArchivedStore = defineStore('archived', () => {
  const items = ref<ConversationSummary[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref('');
  const nextCursor = ref<string | null>(null);
  const restoringId = ref<string | null>(null);
  let revision = 0;

  function reset(): void {
    revision += 1;
    items.value = [];
    loading.value = false;
    loaded.value = false;
    error.value = '';
    nextCursor.value = null;
    restoringId.value = null;
  }
  onScopeDispose(onSessionCleared(reset));

  async function load(more = false): Promise<void> {
    if (!getToken() || (more && (loading.value || !nextCursor.value))) return;
    const requestRevision = ++revision, session = sessionVersion();
    loading.value = true;
    error.value = '';
    try {
      const result = await listConversations(true, more ? nextCursor.value! : undefined);
      if (session !== sessionVersion() || requestRevision !== revision) return;
      const rows = more ? [...items.value, ...result.items] : result.items;
      items.value = rows.filter((row, index) => rows.findIndex((item) => item.id === row.id) === index);
      nextCursor.value = result.nextCursor;
      loaded.value = true;
    } catch (err) {
      if (session === sessionVersion() && requestRevision === revision) error.value = err instanceof Error ? err.message : '归档记录加载失败';
    } finally {
      if (session === sessionVersion() && requestRevision === revision) loading.value = false;
    }
  }

  async function restore(id: string): Promise<boolean> {
    if (restoringId.value || !getToken()) return false;
    const session = sessionVersion();
    restoringId.value = id;
    try {
      const restored = await updateConversation(id, { archived: false });
      if (session !== sessionVersion()) return false;
      revision += 1;
      items.value = items.value.filter((item) => item.id !== id);
      useHistoryStore().applySummary(restored);
      useConversationStore().applySummary(restored);
      void load();
      return true;
    } finally {
      if (session === sessionVersion()) restoringId.value = null;
    }
  }

  return { items, loading, loaded, error, nextCursor, restoringId, load, restore, reset };
});
