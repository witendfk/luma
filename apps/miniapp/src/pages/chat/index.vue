<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import MessageBubble from '@/components/MessageBubble.vue';
import { useConversationStore } from '@/stores/conversation';

const store = useConversationStore();
const draft = ref('');
const busy = ref(false);
onUnload(() => store.stopStream());
onLoad(async (query) => {
  try {
    if (query?.id) await store.open(query.id);
    else { store.reset(); if (query?.text) await store.send(decodeURIComponent(query.text), undefined, query.type === 'knowledge' ? 'knowledge' : 'question'); }
  } catch (err) { store.error = err instanceof Error ? err.message : '对话加载失败'; }
});
watch(() => store.messages.map((m) => m.text).join(''), () => nextTick(() => uni.pageScrollTo({ scrollTop: 999999, duration: 100 })));
async function onSend() {
  const text = draft.value.trim();
  if (!text || store.generating) return;
  draft.value = '';
  await store.send(text);
}
async function onConfirm() {
  if (busy.value) return;
  busy.value = true;
  try { await store.confirm(); }
  catch (err) { store.error = err instanceof Error ? err.message : '核对失败'; }
  finally { busy.value = false; }
}
async function onStop() {
  try { await store.stop(); }
  catch (err) { store.error = err instanceof Error ? err.message : '停止失败'; }
}
</script>

<template>
  <view class="page">
    <view class="title">{{ store.title || '新建对话' }}</view>

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

    <view v-if="store.subject && !store.subject.confirmedAt" class="confirmation">
      <text class="confirm-label">核对学习内容</text>
      <text class="subject-text">{{ store.subject.content.text }}</text>
      <view class="confirm-action" @tap="onConfirm">{{ busy ? '正在确认…' : '内容正确，开始学习' }}</view>
    </view>
    <view v-if="store.waitingJob" class="notice">材料正在生成，可以继续提问。</view>
    <view v-if="store.error" class="error">{{ store.error }}</view>
    <view v-if="store.generating || store.waitingJob" class="stop" @tap="onStop">停止本次生成</view>

    <view class="composer">
      <input v-model="draft" class="input" placeholder="说出你的思路，或请求提示" confirm-type="send" @confirm="onSend" />
      <view class="send" :class="{ busy: store.generating }" @tap="onSend">↑</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.confirmation { margin: 24rpx 0; padding: 28rpx; border: 1rpx solid #d9dfd4; border-radius: 20rpx; background: #fffefa; }
.confirm-label { display: block; color: #8a8f85; font-size: 22rpx; }
.subject-text { display: block; margin: 16rpx 0; font-size: 28rpx; white-space: pre-wrap; }
.confirm-action { padding-top: 20rpx; border-top: 1rpx solid #e8eadf; color: #4f6652; font-size: 26rpx; }
.notice, .error { font-size: 24rpx; padding: 16rpx 0; color: #8a8f85; }
.error { color: #a46950; }

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
