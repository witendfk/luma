<script setup lang="ts">
/**
 * 学习阅读页（FR-05 / 设计文档 §2）：原题、图文讲解、配套练习单屏切换。
 * TODO(第二周)：讲义渲染（Markdown 受控节点 + 原生图片 + 服务端 KaTeX 公式图）、
 * 段落追问（「这一步没懂」携带 sectionId）、配图生成中/失败重试状态。
 */
</script>

<template>
  <view class="page">
    <view class="eyebrow">学习阅读</view>
    <view class="title">原题 · 图文讲解 · 练习</view>
    <view class="card">
      <text class="desc">
        单屏阅读页骨架：顶部切换「原题 / 图文讲解 / 练习」，正文走受控 Markdown 渲染，
        公式由服务端 KaTeX 转 PNG 缓存下发，段落支持追问。返回保留对话上下文。
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
