<script setup lang="ts">
/**
 * 已归档对话（FR-10）：查看、恢复、空状态。
 * 只阅读不改变状态；发送新消息时自动恢复到最近学习。
 * TODO(第二周)：列表数据接入与恢复操作。
 */
</script>

<template>
  <view class="page">
    <view class="eyebrow">已归档</view>
    <view class="title">归档的对话</view>
    <view class="card empty">
      <text class="desc">还没有归档的对话。在对话管理中归档后，会出现在这里。</text>
    </view>
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

.title {
  font-family: Georgia, serif;
  font-size: 44rpx;
  margin: 12rpx 0 32rpx;
}

.card {
  background: #fffefa;
  border: 1rpx solid #dde2d4;
  border-radius: 16rpx;
  padding: 48rpx 32rpx;
}

.empty {
  text-align: center;
}

.desc {
  font-size: 26rpx;
  color: #8a8f85;
}
</style>
