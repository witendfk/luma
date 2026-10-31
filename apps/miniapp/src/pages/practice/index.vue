<script setup lang="ts">
/**
 * 练习页（FR-06/07/08 / 设计文档 §3.3）：intro → doing → review → summary。
 * TODO(第二周)：逐题作答与题号跳转、文字/照片草稿自动保存（递增 draftVersion 防抖）、
 * 暂不会标记、方向提示、围绕这题追问、提交后参考解析与逐题自评、全部/部分重做。
 */
</script>

<template>
  <view class="page">
    <view class="eyebrow">同类练习</view>
    <view class="title">逐题作答 · 自评 · 重做</view>
    <view class="card">
      <text class="desc">
        练习骨架：作答阶段不下发参考答案（题目侧/答案侧分离投影）；提交后进入自评
        （独立做对 / 部分会 / 还不会），完成本轮形成反馈；重做创建新轮次，历史轮次只读。
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
