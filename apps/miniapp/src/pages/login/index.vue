<script setup lang="ts">
import { ref } from 'vue';
import LumaIcon from '@/components/LumaIcon.vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { getToken } from '@/utils/token';
import { UI_MOCK } from '@/config';

const auth = useAuthStore();
const devLogin = UI_MOCK || (import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN === 'true');
const status = ref('');
const loading = ref(false);
const consent = ref(false);
function policy(kind: 'privacy' | 'terms'): void {
  uni.showModal({
    title: kind === 'privacy' ? '隐私政策' : '用户协议',
    content: '正式条款尚未配置，当前仅用于开发联调，请勿提交个人敏感信息。',
    showCancel: false,
    confirmColor: '#4f6652',
  });
}

function help(): void {
  uni.showModal({
    title: '登录帮助',
    content: UI_MOCK ? '当前是离线前端预览，使用独立示例身份。操作只保存在本机，不连接服务端，也不影响正式学习记录。' : devLogin
      ? '当前使用本地测试身份，学习记录保存在本地服务端。正式体验版将使用你的微信身份。'
      : '请确认微信网络正常后重试。重新登录同一账号后，可恢复已同步的学习记录。',
    showCancel: false,
    confirmColor: '#4f6652',
  });
}

// 已有登录态直接进入学习页（FR-01：重新登录同账号后恢复数据）
onShow(() => {
  if (getToken()) {
    uni.switchTab({ url: '/pages/home/index' });
  }
});

function onLogin(): void {
  if (loading.value) return;
  if (!consent.value) { status.value = '请先阅读并勾选协议，再继续登录。'; return; }
  loading.value = true;
  status.value = '正在登录…';
  if (devLogin) {
    auth.loginWithCode('dev:local-student')
      .then(() => uni.switchTab({ url: '/pages/home/index' }))
      .catch((err) => { status.value = err.message; })
      .finally(() => { loading.value = false; });
    return;
  }
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
  <view class="login-page">
    <view class="wordmark-row">
      <view class="wordmark">Luma<text>.</text></view>
      <view class="edition"><text>YOUR LEARNING</text><text>COMPANION</text></view>
    </view>
    <view class="login-copy">
      <view class="kicker"><view class="kicker-line" /><text>一点灵感，慢慢清晰</text></view>
      <view class="headline serif">先想一步，<text>再懂一点。</text></view>
      <view class="intro">把卡住的那一步，<text>变成下一次的恍然大悟。</text></view>
    </view>
    <view class="illustration">
      <image src="/static/login-journey.svg" mode="aspectFit" class="journey" />
    </view>
    <view class="login-actions">
      <view class="action-intro">
        <text>从一道题，开始。</text>
        <text class="action-hint">拍题 · 图文讲解 · 对点练习</text>
      </view>
      <button class="wechat-login" :disabled="loading" @tap="onLogin">
        <LumaIcon name="wechat" white :size="21" />
        <text>{{ loading ? '正在登录…' : '微信登录' }}</text>
      </button>
      <view class="consent-row">
        <view class="consent-label" @tap="consent = !consent; status = ''">
          <view class="check" :class="{ checked: consent }">
            <LumaIcon v-if="consent" name="check" white :size="10" />
          </view>
          <text>我已阅读并同意</text>
        </view>
        <text class="policy-link" @tap="policy('terms')">用户协议</text>
        <text>与</text>
        <text class="policy-link" @tap="policy('privacy')">隐私政策</text>
      </view>
      <view v-if="status" class="login-status">{{ status }}</view>
      <view v-if="devLogin" class="dev-note">{{ UI_MOCK ? '前端预览 · 无需网络 · 使用独立示例身份' : '开发联调 · 使用本地测试身份' }}</view>
    </view>
    <view class="login-footer">
      <text>Luma · 学习从好奇开始</text>
      <button @tap="help">登录帮助</button>
    </view>
  </view>
</template>
<style scoped lang="scss">
.login-page {
  box-sizing:border-box;
  font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;
  color:#354a37;
}
.login-page button {
  margin:0;
  padding:0;
  border:0;
  font-weight:400;
  line-height:1.6;
}
.login-page button::after {
  border:none;
}
.serif {
  font-family:'Songti SC','STSong',serif;
  font-weight:400;
}
.login-page {
  display:flex;
  flex-direction:column;
  height:100vh;
  overflow:hidden;
  padding:48rpx 58rpx max(32rpx, env(safe-area-inset-bottom));
  background:#fafaf6;
}
.wordmark-row {
  flex-shrink:0;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:32rpx;
}
.wordmark {
  font-family:Georgia,serif;
  font-size:64rpx;
  line-height:1;
  letter-spacing:-2rpx;
  color:#344838;
}
.wordmark text {
  color:#a28a65;
}
.edition {
  max-width:240rpx;
  font-size:15rpx;
  letter-spacing:2.5rpx;
  color:#a3ac97;
  line-height:1.9;
  text-align:right;
  white-space:pre-line;
}
.edition text { display: block; }
.login-copy {
  flex-shrink:0;
  margin-top:80rpx;
}
.kicker {
  display:flex;
  align-items:center;
  gap:16rpx;
  color:#9d8a6b;
  font-size:20rpx;
  letter-spacing:2rpx;
  margin-bottom:34rpx;
}
.kicker-line {
  width:32rpx;
  height:1rpx;
  background:#b9a98b;
}
.headline {
  font-size:76rpx;
  line-height:1.55;
  letter-spacing:2rpx;
  color:#354a37;
}
.headline text {
  display:block;
  color:#788d68;
}
.intro {
  font-size:24rpx;
  line-height:1.95;
  color:#9aa38e;
  margin-top:30rpx;
  letter-spacing:1rpx;
}
.intro text {
  display:block;
}
.illustration {
  flex:1;
  min-height:0;
  overflow:hidden;
  display:flex;
  align-items:center;
  margin:8rpx -12rpx 0;
}
.journey {
  width:100%;
  height:100%;
  max-height:370rpx;
}
.login-actions {
  flex-shrink:0;
  margin-top:auto;
  padding-top:20rpx;
}
.action-intro {
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  gap:16rpx;
  color:#64765a;
  font-size:24rpx;
  margin-bottom:28rpx;
}
.action-hint {
  font-size:18rpx;
  color:#a0aa94;
}
.wechat-login {
  display:flex;
  align-items:center;
  justify-content:center;
  gap:18rpx;
  height:96rpx;
  width:100%;
  border-radius:24rpx;
  background:#4e6652;
  color:#f7f9f2;
  font-size:27rpx;
  letter-spacing:2rpx;
  box-shadow:0 6rpx 15rpx #3a52360a;
}
.wechat-login[disabled] {
  background:#4e6652;
  color:#f7f9f2;
}
.consent-row {
  display:flex;
  align-items:center;
  justify-content:center;
  flex-wrap:wrap;
  gap:8rpx;
  margin-top:20rpx;
  font-size:19rpx;
  color:#9fa994;
  min-height:64rpx;
}
.consent-label {
  display:flex;
  align-items:center;
  gap:12rpx;
  min-height:64rpx;
}
.check {
  width:26rpx;
  height:26rpx;
  display:flex;
  align-items:center;
  justify-content:center;
  border:1rpx solid #c8d2bb;
  border-radius:50%;
}
.check.checked {
  background:#728c60;
  border-color:#728c60;
}
.policy-link {
  color:#75866b;
  padding:10rpx 0;
}
.dev-note {
  color:#a5af99;
  text-align:center;
  font-size:18rpx;
  margin-top:4rpx;
}
.login-status {
  color:#a46950;
  text-align:center;
  font-size:21rpx;
  margin-top:10rpx;
}
.login-footer {
  flex-shrink:0;
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding-top:32rpx;
  font-size:18rpx;
  color:#adb6a1;
}
.login-footer button {
  min-height:64rpx;
  color:#9da88f;
  font-size:19rpx;
}


@media (max-height:700px) {
.login-page {
  padding-top:32rpx;
  padding-bottom:max(20rpx, env(safe-area-inset-bottom));
}
.login-copy {
  margin-top:42rpx;
}
.headline {
  font-size:66rpx;
}
.kicker {
  margin-bottom:24rpx;
}
.intro {
  margin-top:22rpx;
  font-size:23rpx;
}
.journey {
  max-height:270rpx;
}
.login-footer {
  padding-top:16rpx;
}

}
</style>
