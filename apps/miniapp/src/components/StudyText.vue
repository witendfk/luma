<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import type { ContentBlock, TeachingReply } from '@luma/shared';
import { UI_MOCK } from '@/config';
import { pendingContentNodes } from '@/utils/study-content';
import { request } from '@/utils/request';
import { onSessionCleared, sessionVersion } from '@/utils/token';
const props = defineProps<{ text: string; content?: TeachingReply; streaming?: boolean }>();
const blocks = ref<ContentBlock[]>([]);
const failed = ref(false);
let revision = 0;
async function typeset(): Promise<void> {
  const version = ++revision, session = sessionVersion(); blocks.value = []; failed.value = false;
  if (UI_MOCK || props.streaming || (!props.content && !/\$|\\\(|\\\[/.test(props.text))) return;
  try {
    const result = await request<{ blocks: ContentBlock[]; failed?: boolean }>({ method: 'POST', path: '/api/content/render', data: { text: props.text, content: props.content } });
    if (version === revision && session === sessionVersion()) { blocks.value = result.blocks; failed.value = !!result.failed; }
  } catch { if (version === revision && session === sessionVersion()) failed.value = true; }
}
watch(() => [props.text, props.streaming, props.content] as const, () => { void typeset(); }, { immediate: true });
onScopeDispose(onSessionCleared(() => { revision++; blocks.value = []; failed.value = false; }));
onScopeDispose(() => { revision++; });
const nodes = computed(() => pendingContentNodes(props.text, failed.value));
</script>
<template><view class="study-text"><template v-if="blocks.length"><template v-for="(block, index) in blocks" :key="index"><rich-text v-if="block.kind === 'text'" :nodes="block.nodes" :selectable="true" /><scroll-view v-else class="display-formula" scroll-x><image :src="block.src" :style="{ width: block.width + 'px', height: block.height + 'px' }" :aria-label="block.fallback" /></scroll-view></template></template><rich-text v-else :nodes="nodes" :selectable="true" /><button v-if="failed && !streaming" class="typeset-retry" @tap="typeset">公式排版暂不可用 · 重试</button></view></template>
<style scoped>
.study-text { font-size:inherit; line-height:inherit; color:inherit; }
.display-formula { width:100%; margin:20rpx 0; white-space:nowrap; }
.display-formula image { display:inline-block; vertical-align:middle; }
.typeset-retry { display:inline-block; margin:8rpx 0; padding:0; border:0; background:transparent; color:#718364; font-size:23rpx; line-height:1.8; }
.typeset-retry::after { border:0; }
</style>
