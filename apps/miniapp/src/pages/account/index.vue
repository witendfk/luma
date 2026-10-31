<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';

/**
 * 账号面板（FR-01）：昵称头像、隐私、登录帮助与退出登录。
 * 不提供模型设置、API Key 等任何配置入口（AC-18）。
 */
const auth = useAuthStore();

function onPrivacy(): void {
  uni.showToast({ title: '隐私政策页待接入', icon: 'none' });
}

function onHelp(): void {
  uni.showToast({ title: '登录帮助页待接入', icon: 'none' });
}

function onLogout(): void {
  uni.showModal({
    title: '退出登录',
    content: '退出后需重新登录才能继续访问本账号的学习记录',
    confirmText: '退出',
    confirmColor: '#a08464',
    success: (res) => {
      if (!res.confirm) return;
      auth.logout().catch(() => {
        uni.showToast({ title: '已退出当前设备', icon: 'none' });
      }).finally(() => {
        uni.reLaunch({ url: '/pages/login/index' });
      });
    },
  });
}
</script>

<template>
  <view class="page">
    <view class="profile">
      <image class="avatar" :src="auth.avatarUrl ?? ''" mode="aspectFill" />
      <view class="name">{{ auth.nickname ?? '未设置昵称' }}</view>
    </view>

    <view class="list">
      <view class="item" @tap="onPrivacy">隐私政策</view>
      <view class="item" @tap="onHelp">登录帮助</view>
      <view class="item danger" @tap="onLogout">退出登录</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding: 48rpx 40rpx;
  background: #f8f7f2;
}

.profile {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 24rpx 0 48rpx;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #dde2d4;
}

.name {
  font-size: 32rpx;
}

.list {
  background: #fffefa;
  border: 1rpx solid #dde2d4;
  border-radius: 16rpx;
  overflow: hidden;
}

.item {
  padding: 28rpx 32rpx;
  font-size: 28rpx;
  border-bottom: 1rpx solid #dde2d4;

  &:last-child {
    border-bottom: none;
  }

  &.danger {
    color: #a08464;
  }
}
</style>
