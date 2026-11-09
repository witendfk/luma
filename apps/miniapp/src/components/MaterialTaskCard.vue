<script setup lang="ts">
import { computed } from 'vue';
import type { MaterialTaskView } from '@luma/shared';
import LumaIcon from './LumaIcon.vue';
const props = defineProps<{ task: MaterialTaskView; busy?: boolean; retrying?: boolean; canStop?: boolean }>();
defineEmits<{ open: []; retry: []; stop: [] }>();
const pending = computed(() => ['queued', 'running'].includes(props.task.status));
const readable = computed(() => props.task.status === 'succeeded' && !!props.task.artifactId);
const kind = computed(() => props.task.type === 'lesson' ? '图文讲解' : '配套练习');
const state = computed(() => props.task.historical ? '历史版本' : ({ queued: '排队中', running: '生成中', succeeded: '已生成', failed: '暂未完成', cancelled: '已停止', superseded: '题目已更新' })[props.task.status]);
</script>

<template>
  <view class="material-card" :class="{ pending, failed: task.status === 'failed' }">
    <view v-if="pending" class="material-loading">
      <view class="loading-ring" /><text class="loading-label">正在生成{{ kind }}…</text>
      <button v-if="canStop" class="loading-stop" aria-label="停止本次生成" @tap="$emit('stop')"><LumaIcon name="close" :size="12" /></button>
    </view>
    <button v-else-if="readable" class="material-main" :aria-label="`查看${kind}：${task.title}`" @tap="$emit('open')">
      <view class="material-meta"><text>{{ kind }}</text><text class="material-state">{{ state }}</text></view>
      <text class="material-title">{{ task.title }}</text>
      <text v-if="task.summary && readable" class="material-summary">{{ task.summary }}</text>
      <view v-if="readable" class="material-entry"><text>{{ task.type === 'lesson' ? '查看讲解' : '查看练习' }}</text><LumaIcon name="arrow-diagonal" :size="13" /></view>
    </button>
    <view v-else class="material-status"><text>{{ kind }}</text><text class="material-state">{{ state }}</text></view>
    <view v-if="task.status === 'failed'" class="material-detail"><text class="detail-label">{{ task.error?.message || '这次未能完成生成，原对话已保留' }}</text><button v-if="task.jobId && !task.historical && task.error?.retryable" class="material-retry" :class="{ muted: busy || retrying }" :disabled="busy || retrying" @tap="$emit('retry')">{{ retrying ? '正在重试…' : '重试' }}</button></view>
  </view>
</template>

<style scoped>
.material-card { margin:0 0 32rpx 68rpx; border:1rpx solid #dce4d3; border-radius:22rpx; background:#f1f4eb; overflow:hidden; }
.material-main,.material-retry,.loading-stop { margin:0; border:0; background:transparent; font-weight:400; line-height:1.6; }
.material-main::after,.material-retry::after,.loading-stop::after { border:0; }
.material-card .material-main { display:block; width:100%; padding:26rpx 28rpx 24rpx; text-align:left; color:#40543e; }
.material-status { display:flex; gap:16rpx; padding:24rpx 28rpx 18rpx; color:#7b8e6d; font-size:22rpx; }
.material-loading { display:flex; align-items:center; gap:18rpx; padding:16rpx 24rpx; min-height:58rpx; }
.loading-label { flex:1; color:#819376; font-size:23rpx; }
.loading-ring { box-sizing:border-box; width:25rpx; height:25rpx; flex-shrink:0; border:3rpx solid #dde5d4; border-top-color:#849b72; border-radius:50%; animation:material-spin 1s linear infinite; }
.material-card .loading-stop { display:flex; align-items:center; justify-content:center; flex-shrink:0; width:60rpx; height:60rpx; padding:0; }
@keyframes material-spin { to { transform:rotate(360deg); } }
.material-meta { display:flex; align-items:center; gap:16rpx; color:#7b8e6d; font-size:20rpx; }
.material-state { color:#96a189; }
.material-title { display:block; margin-top:14rpx; color:#405b3e; font-size:29rpx; line-height:1.65; overflow-wrap:anywhere; }
.material-summary { display:block; margin-top:10rpx; color:#8a9780; font-size:22rpx; line-height:1.7; }
.material-entry { display:flex; align-items:center; justify-content:space-between; margin-top:24rpx; color:#607c52; font-size:23rpx; }
.material-detail { display:flex; align-items:center; gap:14rpx; margin:0 28rpx; padding:18rpx 0 22rpx; border-top:1rpx solid #e0e6d8; color:#8e9b82; font-size:22rpx; line-height:1.7; }
.detail-label { flex:1; min-width:0; }
.material-card .material-retry { flex-shrink:0; padding:8rpx 0 8rpx 20rpx; font-size:23rpx; color:#617b55; }
.muted { opacity:.45; }
.failed { background:#f6f3ec; border-color:#e7e1d5; }
</style>
