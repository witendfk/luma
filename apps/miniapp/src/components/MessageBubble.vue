<script setup lang="ts">
import StudyText from './StudyText.vue';
import type { TeachingReply } from '@luma/shared';
defineProps<{ role: 'user' | 'assistant'; text: string; reply?: TeachingReply; incomplete?: boolean }>();
</script>
<template>
  <view class="message" :class="role">
    <view v-if="role === 'assistant'" class="agent-avatar">✳</view>
    <view class="bubble">
      <text v-if="role === 'assistant'" class="agent-name">Luma</text>
      <StudyText v-if="role === 'assistant'" class="message-text" :text="text" :content="reply" :streaming="incomplete" /><text v-else class="message-text" selectable>{{ text }}</text>
      <text v-if="incomplete" class="incomplete">回复尚未完成</text>
    </view>
  </view>
</template>
<style scoped>
.message { display:flex; align-items:flex-start; gap:18rpx; margin-bottom:46rpx; }
.user { justify-content:flex-end; }
.bubble { min-width:0; }
.user .bubble { max-width:86%; padding:24rpx 30rpx; border-radius:28rpx 28rpx 6rpx 28rpx; background:#e9ede3; color:#354633; }
.assistant .bubble { flex:1; padding-top:1rpx; }
.agent-avatar { display:flex; align-items:center; justify-content:center; width:50rpx; height:50rpx; flex-shrink:0; border-radius:50%; background:#e6eddb; color:#83996f; font-size:27rpx; line-height:1; }
.agent-name { display:block; margin:0 0 16rpx; color:#677e58; font-size:24rpx; line-height:1.8; font-weight:500; }
.message-text { display:block; color:#334032; font-size:28rpx; line-height:1.95; white-space:pre-wrap; overflow-wrap:anywhere; }
.incomplete { display:block; margin-top:12rpx; color:#a08e77; font-size:20rpx; }
</style>
