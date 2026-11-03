<script setup lang="ts">
import { UI_MOCK } from '@/config';
</script>
<template><view v-if="UI_MOCK" class="preview-notice">前端预览 · 示例数据 · 不连接服务端</view></template>
<style scoped>.preview-notice { flex-shrink:0; padding:8rpx 20rpx; background:#f3eee4; color:#a08b6d; text-align:center; font-size:19rpx; line-height:1.8; }</style>
