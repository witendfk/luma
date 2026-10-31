<script setup lang="ts">
defineProps<{
  role: 'user' | 'assistant';
  text: string;
  incomplete?: boolean;
}>();
</script>

<template>
  <view class="row" :class="role">
    <view class="bubble">
      <text class="text">{{ text }}</text>
      <text v-if="incomplete" class="mark">（未生成完）</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.row {
  display: flex;
  margin: 16rpx 0;

  &.user {
    justify-content: flex-end;

    .bubble {
      background: #4f6652;
      color: #fffefa;
    }
  }

  &.assistant {
    justify-content: flex-start;

    .bubble {
      background: #fffefa;
      color: #2f3b2f;
      border: 1rpx solid #dde2d4;
    }
  }
}

.bubble {
  max-width: 78%;
  border-radius: 16rpx;
  padding: 16rpx 24rpx;
  font-size: 28rpx;
  word-break: break-all;
}

.mark {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  opacity: 0.6;
}
</style>
