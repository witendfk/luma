<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import LumaIcon from './LumaIcon.vue';
defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const auth = useAuthStore();
const leaving = ref(false);
const name = computed(() => auth.nickname || '同学');
function information(kind: 'privacy' | 'help'): void {
  uni.showModal({ title: kind === 'privacy' ? '隐私政策' : '登录帮助', content: kind === 'privacy' ? '正式条款尚未配置，当前仅用于开发联调，请勿提交个人敏感信息。' : '重新登录同一账号后，可恢复已保存的学习记录。如登录失败，请检查网络后重试。', showCancel: false, confirmColor: '#4f6652' });
}
function logout(): void {
  if (leaving.value) return;
  uni.showModal({ title: '退出登录', content: '学习记录会保留。重新登录同一账号后，可以继续学习。', confirmText: '退出', confirmColor: '#a08464', success: async (res) => {
    if (!res.confirm) return;
    leaving.value = true;
    try { await auth.logout(); } catch { uni.showToast({ title: '已退出当前设备', icon: 'none' }); }
    finally { leaving.value = false; emit('close'); uni.reLaunch({ url: '/pages/login/index' }); }
  } });
}
</script>
<template>
  <view v-if="open" class="panel-layer" @touchmove.stop.prevent>
    <view class="scrim" @tap="emit('close')" />
    <view class="panel">
      <view class="handle" />
      <view class="panel-heading"><text>我的账号</text><button aria-label="关闭账号面板" @tap="emit('close')"><LumaIcon name="close" :size="18" /></button></view>
      <view class="identity"><image v-if="auth.avatarUrl" class="avatar" :src="auth.avatarUrl" mode="aspectFill" /><view v-else class="avatar">{{ name.slice(0, 1) }}</view><view><text class="name">{{ name }}</text><text class="intro">在 Luma，留住每一次想明白。</text></view></view>
      <view class="links"><button @tap="information('privacy')"><LumaIcon name="shield" :size="18" /><text>隐私政策</text></button><button @tap="information('help')"><LumaIcon name="help" :size="18" /><text>登录帮助</text></button></view>
      <button class="logout" :disabled="leaving" @tap="logout"><LumaIcon name="logout" :size="16" /><text>{{ leaving ? '正在退出…' : '退出登录' }}</text></button>
      <text class="caption">你的每一步思考，都值得留下。</text>
    </view>
  </view>
</template>
<style scoped>
.panel-layer { position:fixed; inset:0; z-index:120; }
.scrim { position:absolute; inset:0; background:rgba(38,51,40,.24); backdrop-filter:blur(3px); }
.panel { position:absolute; bottom:0; left:0; right:0; padding:48rpx 46rpx max(42rpx,env(safe-area-inset-bottom)); border-radius:48rpx 48rpx 0 0; background:#fdfcf8; color:#3b4e3c; }
.handle { position:absolute; top:18rpx; left:calc(50% - 28rpx); width:56rpx; height:6rpx; border-radius:6rpx; background:#d9e1cd; }
.panel button { margin:0; padding:0; border:0; background:transparent; font-weight:400; }
.panel button::after { border:0; }
.panel-heading { display:flex; align-items:center; justify-content:space-between; font-size:29rpx; }
.panel-heading button { display:flex; align-items:center; justify-content:center; width:64rpx; height:64rpx; }
.identity { display:flex; align-items:center; gap:28rpx; padding:38rpx 0 44rpx; border-bottom:1rpx solid #e7ebdf; }
.avatar { display:flex; align-items:center; justify-content:center; width:100rpx; height:100rpx; border-radius:36rpx; flex-shrink:0; background:#e9efdf; color:#69805d; font-size:38rpx; font-family:'Songti SC',serif; }
.name { display:block; font-size:36rpx; }
.intro { display:block; margin-top:16rpx; font-size:20rpx; color:#96a08d; }
.links { padding:14rpx 0; border-bottom:1rpx solid #e7ebdf; }
.links button { display:flex; align-items:center; gap:24rpx; width:100%; min-height:100rpx; text-align:left; font-size:25rpx; color:#718363; }
.panel .logout { display:flex; align-items:center; justify-content:center; gap:14rpx; width:100%; min-height:104rpx; color:#a18d77; font-size:24rpx; }
.caption { display:block; text-align:center; color:#b0b8a4; font-size:18rpx; padding-top:10rpx; }
</style>
