<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import type { ContentBlock } from '@luma/shared';
import { UI_MOCK } from '@/config';
import { request } from '@/utils/request';
import { onSessionCleared, sessionVersion } from '@/utils/token';
const props = defineProps<{ text: string; streaming?: boolean }>();
const blocks = ref<ContentBlock[]>([]);
let revision = 0;
watch(() => [props.text, props.streaming] as const, async ([text, streaming]) => {
  const version = ++revision, session = sessionVersion(); blocks.value = [];
  if (UI_MOCK || streaming || !/\$|\\\(|\\\[/.test(text)) return;
  try {
    const result = await request<{ blocks: ContentBlock[] }>({ method: 'POST', path: '/api/content/render', data: { text } });
    if (version === revision && session === sessionVersion()) blocks.value = result.blocks;
  } catch { /* Keep readable original text if typesetting is unavailable. */ }
}, { immediate: true });
onScopeDispose(onSessionCleared(() => { revision++; blocks.value = []; }));
onScopeDispose(() => { revision++; });
// 模型正文只映射为受控节点；原始 HTML 和外部资源保持普通文字。
const nodes = computed(() => props.text.split(/\n\s*\n/).filter(Boolean).map((paragraph) => ({
  name: 'p', attrs: { style: 'margin:0 0 14px;white-space:pre-wrap;word-break:break-word;' },
  children: paragraph.replace(/^#{1,4}\s+/gm, '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) =>
    part.startsWith('**') && part.endsWith('**')
      ? { name: 'strong', attrs: { style: 'font-weight:500;color:#40543e;' }, children: [{ type: 'text', text: part.slice(2, -2) }] }
      : { type: 'text', text: part }),
})));
</script>
<template><view class="study-text"><template v-if="blocks.length"><template v-for="(block, index) in blocks" :key="index"><rich-text v-if="block.kind === 'text'" :nodes="block.nodes" :selectable="true" /><scroll-view v-else class="display-formula" scroll-x><image :src="block.src" :style="{ width: block.width + 'px', height: block.height + 'px' }" :aria-label="block.fallback" /></scroll-view></template></template><rich-text v-else :nodes="nodes" :selectable="true" /></view></template>
<style scoped>
.study-text { font-size:inherit; line-height:inherit; color:inherit; }
.display-formula { width:100%; margin:20rpx 0; white-space:nowrap; }
.display-formula image { display:inline-block; vertical-align:middle; }
</style>
