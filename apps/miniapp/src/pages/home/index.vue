<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * 新建对话页（FR-02 / 设计文档 §2）。
 * TODO(第一周)：创建会话 → 预填输入 → 跳对话页；继续上次学习指向最近活动的未归档对话。
 */
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

function onEntry(title: string): void {
  // TODO(第一周)：预填输入框并聚焦（FR-02 首页三入口）
  uni.showToast({ title: `「${title}」接入会话接口后开放`, icon: 'none' });
}

function onContinue(): void {
  // TODO(第一周)：跳最近活动的未归档对话（FR-10）
  uni.showToast({ title: '继续学习接入会话接口后开放', icon: 'none' });
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
        <view class="send" @tap="onContinue">发送</view>
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
