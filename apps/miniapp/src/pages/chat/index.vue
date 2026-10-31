<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { onUnload } from '@dcloudio/uni-app';
import MessageBubble from '@/components/MessageBubble.vue';
import { useConversationStore } from '@/stores/conversation';
import type { StreamEvent } from '@luma/shared';
import { openTurnStream } from '@/utils/sse';

/**
 * 对话页（FR-04）：消息流 + 输入区。
 * 已按设计文档 §10 接好分块流式管道（utils/sse）；会话创建接口就绪后即连通。
 */
const store = useConversationStore();
const draft = ref('');
const generating = computed(() => store.generating);
onUnload(() => store.stopStream());

function scrollToBottom(): void {
  nextTick(() => {
    uni.pageScrollTo({ scrollTop: 999999, duration: 100 });
  });
}

function handleEvent(event: StreamEvent): void {
  const msgs = store.messages;
  if (event.type === 'run.started') return;
  if (event.type === 'text.delta') {
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant' && last.incomplete) {
      last.text += event.delta;
    } else {
      store.appendLocalMessage({ role: 'assistant', text: event.delta });
      const added = msgs[msgs.length - 1];
      if (added) added.incomplete = true;
    }
    scrollToBottom();
    return;
  }
  if (event.type === 'run.completed') {
    const last = msgs[msgs.length - 1];
    if (last) last.incomplete = false;
    store.generating = false;
    scrollToBottom();
    return;
  }
  if (event.type === 'run.failed') {
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant') last.incomplete = true;
    store.generating = false;
    uni.showToast({ title: event.error.message, icon: 'none' });
    return;
  }
  if (event.type === 'run.cancelled') {
    store.generating = false;
  }
}

function onSend(): void {
  const text = draft.value.trim();
  if (!text || generating.value) return;
  draft.value = '';
  store.appendLocalMessage({ role: 'user', text });
  store.generating = true;
  scrollToBottom();

  // TODO(第一周)：无会话时先 POST /api/conversations 创建，再发首条消息（FR-02）
  const conversationId = store.currentId;
  if (!conversationId) {
    store.generating = false;
    uni.showToast({ title: '会话创建接口接入后开放', icon: 'none' });
    return;
  }

  const handle = openTurnStream({
    conversationId,
    body: {
      requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
    },
    onEvent: handleEvent,
    onDone: () => {
      store.generating = false;
    },
    onError: (message) => {
      store.generating = false;
      uni.showToast({ title: message, icon: 'none' });
    },
  });
  store.setStream(handle);
}

function onStop(): void {
  store.stopStream();
}
</script>

<template>
  <view class="page">
    <view class="title">{{ store.title || '新对话' }}</view>

    <view v-if="store.messages.length === 0" class="empty">
      <text>把题目或没听懂的知识点发给我，我先引导你想，而不是直接给答案。</text>
    </view>

    <MessageBubble
      v-for="msg in store.messages"
      :key="msg.id"
      :role="msg.role"
      :text="msg.text"
      :incomplete="msg.incomplete"
    />

    <view v-if="generating" class="stop" @tap="onStop">■ 停止生成</view>

    <view class="composer">
      <input v-model="draft" class="input" placeholder="说出你的思路，或请求提示" confirm-type="send" @confirm="onSend" />
      <view class="send" :class="{ busy: generating }" @tap="onSend">↑</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding: 24rpx 32rpx 200rpx;
  background: #f8f7f2;
}

.title {
  font-size: 30rpx;
  color: #2f3b2f;
  margin-bottom: 16rpx;
}

.empty {
  background: #fffefa;
  border: 1rpx solid #dde2d4;
  border-radius: 16rpx;
  padding: 32rpx;
  color: #8a8f85;
  font-size: 26rpx;
}

.stop {
  text-align: center;
  color: #a08464;
  font-size: 24rpx;
  padding: 16rpx;
}

.composer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 32rpx calc(16rpx + env(safe-area-inset-bottom));
  background: #fffefa;
  border-top: 1rpx solid #dde2d4;
}

.input {
  flex: 1;
  background: #f8f7f2;
  border-radius: 999rpx;
  padding: 14rpx 28rpx;
  font-size: 28rpx;
}

.send {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #4f6652;
  color: #fffefa;
  font-size: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;

  &.busy {
    opacity: 0.5;
  }
}
</style>
