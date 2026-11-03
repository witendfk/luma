<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import LumaIcon from '@/components/LumaIcon.vue';
import { useNotebookPreviewStore } from '@/stores/notebook-preview';
import { useStudyPreviewStore } from '@/stores/study-preview';
const study = useStudyPreviewStore();
const notebook = useNotebookPreviewStore();
const saved = computed(() => notebook.records.some((r) => r.id === study.scope && r.collected));
onShow(() => notebook.refresh());
function save(): void {
  if (saved.value) { uni.switchTab({ url: '/pages/notebook/index' }); return; }
  try { notebook.update(study.scope, { collected: true }); uni.showToast({ title: '已保存到错题本', icon: 'none' }); }
  catch { uni.showToast({ title: '保存失败，请重试', icon: 'none' }); }
}
</script>
<template><button class="save-record" @tap="save"><LumaIcon name="bookmark" :size="16" /><text>{{ saved ? '已保存 · 去错题本' : '保存学习记录' }}</text></button></template>
<style scoped>
.save-record { display:flex; align-items:center; gap:12rpx; margin:0; padding:0 38rpx; min-height:80rpx; border:0; border-radius:0; background:transparent; color:#8c9d7b; font-size:22rpx; line-height:1.7; }
.save-record::after { border:0; }
</style>
