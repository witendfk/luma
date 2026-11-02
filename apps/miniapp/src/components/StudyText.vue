<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ text: string }>();
// 模型正文只映射为受控节点；原始 HTML 和外部资源保持普通文字。
const nodes = computed(() => props.text.split(/\n\s*\n/).filter(Boolean).map((paragraph) => ({
  name: 'p', attrs: { style: 'margin:0 0 14px;white-space:pre-wrap;word-break:break-word;' },
  children: paragraph.replace(/^#{1,4}\s+/gm, '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) =>
    part.startsWith('**') && part.endsWith('**')
      ? { name: 'strong', attrs: { style: 'font-weight:500;color:#40543e;' }, children: [{ type: 'text', text: part.slice(2, -2) }] }
      : { type: 'text', text: part }),
})));
</script>
<template><rich-text class="study-text" :nodes="nodes" :selectable="true" /></template>
<style scoped>
.study-text { font-size:29rpx; line-height:1.95; color:#52604d; }
</style>
