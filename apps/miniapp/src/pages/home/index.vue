<script setup lang="ts">
import { computed, ref } from 'vue';
import { listConversations } from '@/api/conversations';
import { getToken } from '@/utils/token';

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
});
const draft = ref('');
const entries = [
  { icon: '📷', title: '拍题求助', desc: '拍照或输入题目，逐层引导' },
  { icon: '📖', title: '讲知识点', desc: '没听懂的内容，图文讲给你' },
  { icon: '✏️', title: '出练习', desc: '同知识点练习与自评' },
];
const subjectType = ref<'question' | 'knowledge'>('question');
function onEntry(title: string): void {
  subjectType.value = title === '讲知识点' ? 'knowledge' : 'question';
  if (title === '拍题求助') uni.showToast({ title: '本轮先支持文字题目，拍照正在接入', icon: 'none' });
}
function onSend(): void {
  const text = draft.value.trim();
  if (!text) return;
  if (!getToken()) { uni.navigateTo({ url: '/pages/login/index' }); return; }
  uni.navigateTo({ url: `/pages/chat/index?text=${encodeURIComponent(text)}&type=${subjectType.value}` });
  draft.value = '';
}
async function onContinue(): Promise<void> {
  try {
    const result = await listConversations(false);
    if (result.items[0]) uni.navigateTo({ url: `/pages/chat/index?id=${result.items[0].id}` });
    else uni.showToast({ title: '还没有对话，先发一道题吧', icon: 'none' });
  } catch (err) { uni.showToast({ title: err instanceof Error ? err.message : '加载失败', icon: 'none' }); }
}
</script>

<template>
  <view class="page">
    <view class="eyebrow">LUMA</view>
    <view class="greeting">{{ greeting }}</view>
    <view class="sub">今天想弄懂什么？</view>

    <view class="input-card">
      <textarea
        v-model="draft"
        class="input"
        :maxlength="2000"
        placeholder="输入题目或知识点，也可以拍照上传"
        :auto-height="true"
      />
      <view class="toolbar">
        <text class="tool">📷 拍照</text>
        <text class="tool">🖼 相册</text>
        <view class="send" @tap="onSend">发送</view>
      </view>
    </view>

    <view class="entries">
      <view v-for="item in entries" :key="item.title" class="entry" @tap="onEntry(item.title)">
        <text class="icon">{{ item.icon }}</text>
        <view class="entry-text">
          <text class="title">{{ item.title }}</text>
          <text class="desc">{{ item.desc }}</text>
        </view>
      </view>
    </view>

    <view class="continue" @tap="onContinue">↩ 继续上次学习</view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding: 48rpx 40rpx;
  background: #f8f7f2;
}

.eyebrow {
  font-size: 20rpx;
  letter-spacing: 0.3em;
  color: #a08464;
}

.greeting {
  font-family: Georgia, serif;
  font-size: 52rpx;
  margin: 12rpx 0 4rpx;
}

.sub {
  color: #8a8f85;
  font-size: 26rpx;
}

.input-card {
  margin-top: 40rpx;
  background: #fffefa;
  border: 1rpx solid #dde2d4;
  border-radius: 20rpx;
  padding: 24rpx;
}

.input {
  width: 100%;
  min-height: 120rpx;
  font-size: 28rpx;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 24rpx;
  margin-top: 16rpx;
}

.tool {
  color: #4f6652;
  font-size: 26rpx;
}

.send {
  margin-left: auto;
  background: #4f6652;
  color: #fffefa;
  font-size: 26rpx;
  padding: 10rpx 32rpx;
  border-radius: 999rpx;
}

.entries {
  margin-top: 40rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.entry {
  display: flex;
  align-items: center;
  gap: 20rpx;
  background: #fffefa;
  border: 1rpx solid #dde2d4;
  border-radius: 16rpx;
  padding: 24rpx;
}

.icon {
  font-size: 40rpx;
}

.entry-text {
  display: flex;
  flex-direction: column;
}

.title {
  font-size: 28rpx;
  color: #2f3b2f;
}

.desc {
  font-size: 24rpx;
  color: #8a8f85;
}

.continue {
  margin-top: 48rpx;
  text-align: center;
  color: #4f6652;
  font-size: 26rpx;
}
</style>
