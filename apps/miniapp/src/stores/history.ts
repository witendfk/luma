import { computed, onScopeDispose, ref } from 'vue';
import { defineStore } from 'pinia';
import { listConversations, type ConversationSummary } from '@/api/conversations';
import { getToken, onSessionCleared, sessionVersion } from '@/utils/token';

/** 最近学习只读取当前账号的真实会话，切换账号时拒绝迟到响应。 */
export const useHistoryStore = defineStore('history', () => {
  const items = ref<ConversationSummary[]>([]);
  const loading = ref(false);
  const error = ref('');
  const nextCursor = ref<string | null>(null);
  const loaded = ref(false);
  let revision = 0;
  const latest = computed(() => items.value[0] ?? null);

  function reset(): void {
    revision += 1;
    items.value = [];
    nextCursor.value = null;
    loading.value = false;
    loaded.value = false;
    error.value = '';
  }
  onScopeDispose(onSessionCleared(reset));

  async function load(more = false): Promise<void> {
    if (!getToken() || (more && (loading.value || !nextCursor.value))) return;
    const requestRevision = ++revision;
    const session = sessionVersion();
    loading.value = true;
    error.value = '';
    try {
      const result = await listConversations(false, more ? nextCursor.value! : undefined);
      if (session !== sessionVersion() || requestRevision !== revision) return;
      const rows = more ? [...items.value, ...result.items] : result.items;
      items.value = rows.filter((row, index) => rows.findIndex((item) => item.id === row.id) === index);
      nextCursor.value = result.nextCursor;
      loaded.value = true;
    } catch (err) {
      if (session === sessionVersion() && requestRevision === revision) {
        error.value = err instanceof Error ? err.message : '学习记录加载失败';
      }
    } finally {
      if (session === sessionVersion() && requestRevision === revision) loading.value = false;
    }
  }

  return { items, latest, nextCursor, loading, loaded, error, load, reset };
});
