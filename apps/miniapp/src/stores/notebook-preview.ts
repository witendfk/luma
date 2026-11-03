import { computed, onScopeDispose, ref } from 'vue';
import { defineStore } from 'pinia';
import { editPreview, previewRecords, type PreviewRecord } from '@/mocks/workspace';
import { onSessionCleared } from '@/utils/token';
export const useNotebookPreviewStore = defineStore('notebook-preview', () => {
  const records = ref<PreviewRecord[]>([]);
  const keyword = ref('');
  const view = ref<'question' | 'lesson' | 'practice'>('question');
  const status = ref<'all' | 'to_review' | 'reviewed'>('all');
  const collected = computed(() => records.value.filter((r) => r.collected));
  const visible = computed(() => collected.value.filter((r) => {
    const word = keyword.value.trim().toLowerCase();
    return (view.value === 'question' || r[view.value]) && (status.value === 'all' || r.reviewStatus === status.value) &&
      (!word || [r.title, r.text, ...r.tags].join(' ').toLowerCase().includes(word));
  }));
  function refresh(): void { records.value = previewRecords(); }
  function update(id: string, patch: Partial<Pick<PreviewRecord, 'note' | 'reviewStatus' | 'collected'>>): void { editPreview(id, patch); refresh(); }
  onScopeDispose(onSessionCleared(() => { records.value = []; keyword.value = ''; view.value = 'question'; status.value = 'all'; }));
  return { records, keyword, view, status, collected, visible, refresh, update };
});
