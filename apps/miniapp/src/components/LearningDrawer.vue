<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useHistoryStore } from '@/stores/history';
import { useAuthStore } from '@/stores/auth';
import { activityTime, groupHistory } from '@/utils/history';
import LumaIcon from './LumaIcon.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'new'): void; (e: 'select', id: string): void; (e: 'account'): void }>();
const history = useHistoryStore();
const auth = useAuthStore();
const expanded = ref(true);
const groups = computed(() => groupHistory(history.items));
const displayName = computed(() => auth.nickname || '同学');
watch(() => props.open, (open) => {
  if (open) {
    void history.load();
  }
});
function navigate(page: string, tab = false): void {
  emit('close');
  if (tab) uni.switchTab({ url: page });
  else uni.navigateTo({ url: page });
}
</script>
<template>
  <view v-if="open" class="drawer-layer" @touchmove.stop.prevent>
    <view class="scrim" aria-label="关闭学习菜单" @tap="emit('close')" />
    <view class="drawer">
      <view class="brand-row">
        <view><view class="brand">Luma<text>.</text></view><text class="subtitle">留一点时间，想明白。</text></view>
        <button class="close" aria-label="关闭学习菜单" @tap="emit('close')"><LumaIcon name="close" :size="18" /></button>
      </view>
      <button class="nav-row" @tap="emit('new')"><LumaIcon name="plus" /><text>新建对话</text></button>
      <button class="nav-row" @tap="navigate('/pages/notebook/index', true)"><LumaIcon name="bookmark" /><text>我的错题本</text></button>
      <view class="history-head">
        <text>最近学习</text>
        <button class="fold" :aria-label="expanded ? '收起学习历史' : '展开学习历史'" @tap="expanded = !expanded"><LumaIcon :name="expanded ? 'chevron-up' : 'chevron-down'" :size="15" /></button>
      </view>
      <scroll-view v-if="expanded" scroll-y class="history-list">
        <view v-if="history.loading && !history.items.length" class="list-state">正在找回你的学习记录…</view>
        <view v-if="history.error" class="list-state error"><text>{{ history.error }}</text><button class="retry" :disabled="history.loading" @tap="history.load()">重新加载</button></view>
        <view v-else-if="history.loaded && !history.items.length" class="list-state">还没有学习对话<text class="empty-note">新的问题，会在这里留下思路。</text></view>
        <view v-for="group in groups" :key="group.label">
          <view class="history-date">{{ group.label }}</view>
          <button v-for="item in group.items" :key="item.id" class="history-item" @tap="emit('select', item.id)">
            <text class="history-title">{{ item.title }}</text><text class="history-time">{{ activityTime(item.lastActiveAt) }}</text>
          </button>
        </view>
        <button v-if="history.nextCursor" class="load-more" :disabled="history.loading" @tap="history.load(true)">{{ history.loading ? '正在加载…' : '更早的学习记录' }}</button>
      </scroll-view>
      <view v-else class="collapsed-space" />
      <view class="drawer-footer">
        <button class="archive-row" @tap="navigate('/pages/archived/index')"><LumaIcon name="archive" :size="19" /><text>已归档对话</text></button>
        <button class="profile" @tap="emit('close'); emit('account')">
          <image v-if="auth.avatarUrl" class="avatar" :src="auth.avatarUrl" mode="aspectFill" />
          <view v-else class="avatar initial">{{ displayName.slice(0, 1) }}</view>
          <view class="profile-copy"><text class="nickname">{{ displayName }}</text><text class="account-label">我的账号</text></view>
        </button>
      </view>
    </view>
  </view>
</template>
<style scoped>
.drawer-layer { position:fixed; inset:0; z-index:100; }
.scrim { position:absolute; inset:0; background:rgba(38,51,40,.24); }
.drawer { position:absolute; left:0; top:0; bottom:0; width:84%; max-width:648rpx; box-sizing:border-box; display:flex; flex-direction:column; padding:48rpx 38rpx max(36rpx, env(safe-area-inset-bottom)); background:#f7f8f2; box-shadow:20rpx 0 80rpx rgba(35,50,31,.04); }
.drawer button { margin:0; padding:0; text-align:left; border:0; background:transparent; line-height:1.5; font-weight:400; }
.drawer button::after { border:0; }
.brand-row { display:flex; align-items:flex-start; justify-content:space-between; gap:16rpx; margin:0 4rpx 48rpx; flex-shrink:0; }
.brand { font:58rpx/1 Georgia,serif; color:#304235; letter-spacing:-1.6rpx; }
.brand text { color:#aa916d; }
.subtitle { display:block; margin-top:18rpx; font-size:20rpx; letter-spacing:1rpx; color:#899180; }
.drawer .close { display:flex; align-items:center; justify-content:center; width:72rpx; height:72rpx; margin-top:-14rpx; }
.drawer .nav-row { display:flex; align-items:center; gap:26rpx; width:100%; min-height:96rpx; padding:0 20rpx; box-sizing:border-box; color:#405443; font-size:28rpx; flex-shrink:0; }
.nav-row:active,.history-item:active { background:#edf1e6; border-radius:16rpx; }
.history-head { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; margin-top:36rpx; padding:24rpx 20rpx 6rpx; border-top:1rpx solid #e4e8dc; font-size:22rpx; color:#909888; }
.drawer .fold { display:flex; align-items:center; justify-content:center; width:60rpx; height:60rpx; }
.history-list,.collapsed-space { flex:1; min-height:0; height:0; }
.history-date { margin:26rpx 22rpx 10rpx; color:#a2aa98; font-size:18rpx; }
.drawer .history-item { display:block; width:100%; padding:20rpx 22rpx; box-sizing:border-box; }
.history-title { display:block; color:#54654d; font-size:24rpx; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.history-time { display:block; margin-top:8rpx; font-size:18rpx; color:#a0aa95; }
.list-state { padding:40rpx 22rpx; color:#8d9982; font-size:24rpx; line-height:1.8; }
.empty-note { display:block; margin-top:12rpx; color:#a4ad9b; font-size:20rpx; }
.drawer .retry,.drawer .load-more { padding:20rpx 22rpx; font-size:23rpx; color:#617754; }
.error { color:#a46950; }
.drawer-footer { margin-top:auto; flex-shrink:0; border-top:1rpx solid #e4e8dc; padding-top:10rpx; }
.drawer .archive-row { display:flex; align-items:center; gap:26rpx; padding:16rpx 20rpx; min-height:90rpx; box-sizing:border-box; font-size:24rpx; color:#7c8a71; }
.drawer .profile { display:flex; align-items:center; gap:24rpx; width:100%; margin-top:12rpx; padding:28rpx 18rpx 0; border-top:1rpx solid #e4e8dc; }
.avatar { width:72rpx; height:72rpx; border-radius:26rpx; flex-shrink:0; background:#e6ecdd; }
.initial { display:flex; align-items:center; justify-content:center; color:#647d55; font-size:26rpx; }
.profile-copy { display:flex; flex-direction:column; gap:6rpx; }
.nickname { font-size:24rpx; color:#43503e; font-weight:500; }
.account-label { font-size:18rpx; color:#9ba58e; }
</style>
