<script setup lang="ts">
/**
 * 错题详情（FR-09）：原题与原图、讲解、练习历史、笔记、复习状态、回到原对话。
 * TODO(第二周)：数据接入与各入口跳转。
 */
</script>

<template>
  <view class="page">
    <view class="eyebrow">错题详情</view>
    <view class="title">详情骨架</view>
    <view class="card">
      <text class="desc">
        详情骨架：原题与原图 → 阅读讲解 → 继续练习 → 查看练习轮次历史；
        笔记保存与复习状态（待复习/已复习）手动更新；可回到原对话。
      </text>
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
  padding: 32rpx;
}

.desc {
  font-size: 26rpx;
  color: #8a8f85;
  line-height: 1.8;
}
</style>
