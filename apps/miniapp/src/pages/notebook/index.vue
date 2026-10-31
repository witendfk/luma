<script setup lang="ts">
/**
 * 错题本（FR-09 / 设计文档 §2）：搜索、视角切换（错题/讲解/练习）、待复习/已复习筛选。
 * TODO(第二周)：列表与详情、笔记编辑、复习状态手动确认、回到原对话；底部导航页之一。
 */
</script>

<template>
  <view class="page">
    <view class="eyebrow">错题本</view>
    <view class="title">收藏的题目与讲解</view>
    <view class="card">
      <text class="desc">
        错题本骨架：关键词搜索（题干与知识点）、三个查看视角、复习状态筛选。
        移除收藏需确认，仅取消收藏，原对话与练习记录保留。
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
