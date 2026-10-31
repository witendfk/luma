<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { getToken } from '@/utils/token';

const auth = useAuthStore();
const status = ref('');
const loading = ref(false);

// 已有登录态直接进入学习页（FR-01：重新登录同账号后恢复数据）
onShow(() => {
  if (getToken()) {
    uni.switchTab({ url: '/pages/home/index' });
  }
});

function onLogin(): void {
  if (loading.value) return;
  loading.value = true;
  status.value = '正在登录…';
  uni.login({
    provider: 'weixin',
    success: (res) => {
      auth
        .loginWithCode(res.code)
        .then(() => {
          status.value = '登录成功';
          uni.switchTab({ url: '/pages/home/index' });
        })
        .catch((err: unknown) => {
          status.value = err instanceof Error ? err.message : '登录失败，请重试';
        })
        .finally(() => {
          loading.value = false;
        });
    },
    fail: (err) => {
      status.value = err.errMsg ?? '已取消登录';
      loading.value = false;
    },
  });
}
</script>

<template>
  <view class="page">
    <view class="eyebrow">LUMA</view>
    <view class="brand">Luma</view>
    <view class="slogan">拍题求助 · 启发引导 · 图文讲解 · 同类练习</view>

    <button class="login-btn" :disabled="loading" @tap="onLogin">微信登录</button>
    <view class="agreement">登录代表同意《用户协议》与《隐私政策》</view>
    <view v-if="status" class="status">{{ status }}</view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding: 200rpx 64rpx 0;
  background: #f8f7f2;
}

.eyebrow {
  font-size: 22rpx;
  letter-spacing: 0.3em;
  color: #a08464;
}

.brand {
  font-family: Georgia, serif;
  font-size: 72rpx;
  color: #2f3b2f;
  margin: 12rpx 0 8rpx;
}

.slogan {
  font-size: 26rpx;
  color: #8a8f85;
}

.login-btn {
  margin-top: 120rpx;
  background: #4f6652;
  color: #fffefa;
  border-radius: 16rpx;

  &::after {
    border: none;
  }

  &[disabled] {
    opacity: 0.6;
  }
}

.agreement {
  margin-top: 24rpx;
  font-size: 22rpx;
  color: #8a8f85;
  text-align: center;
}

.status {
  margin-top: 32rpx;
  font-size: 26rpx;
  color: #a08464;
  text-align: center;
}
</style>
