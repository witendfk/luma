<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useHistoryStore } from '@/stores/history';
import { useAuthStore } from '@/stores/auth';
import { activityTime, groupHistory } from '@/utils/history';
import { updateConversation } from '@/api/conversations';
import { useConversationStore } from '@/stores/conversation';
import { sessionVersion } from '@/utils/token';
import LumaIcon from './LumaIcon.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'new'): void; (e: 'select', id: string): void; (e: 'account'): void }>();
const history = useHistoryStore();
const auth = useAuthStore();
const expanded = ref(true);
const actionItem = ref<string | null>(null);
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
async function manage(id: string): Promise<void> {
  if (actionItem.value) return;
  const session = sessionVersion();
  const item = history.items.find((entry) => entry.id === id);
  if (!item) return;
  const result = await new Promise<UniApp.ShowActionSheetRes | null>((resolve) => {
    uni.showActionSheet({ itemList: ['重命名', '归档'], success: resolve, fail: () => resolve(null) });
  });
  if (!result || session !== sessionVersion() || !props.open) return;
  if (result.tapIndex === 0) rename(id, item.title);
  else await update(id, { archived: true });
}
function rename(id: string, initial: string, original = initial): void {
  const session = sessionVersion();
  uni.showModal({
    title: '重命名对话', editable: true, content: initial,
    placeholderText: '给这段学习起个名字', confirmText: '保存', confirmColor: '#4f6652',
    success: async (res) => {
      if (!res.confirm || session !== sessionVersion() || !props.open) return;
      const title = (res.content ?? '').trim();
      if (!title || title.length > 60) {
        uni.showToast({ title: !title ? '名称不能为空' : '名称最多 60 个字', icon: 'none' });
        rename(id, res.content ?? '', original);
        return;
      }
      if (title !== original && !(await update(id, { title })) && session === sessionVersion() && props.open) rename(id, title, original);
    },
  });
}
async function update(id: string, patch: { title?: string; archived?: boolean }): Promise<boolean> {
  if (actionItem.value) return false;
  const session = sessionVersion();
  actionItem.value = id;
  try {
    const item = await updateConversation(id, patch);
    if (session !== sessionVersion()) return false;
    history.applySummary(item);
    useConversationStore().applySummary(item);
    void history.load();
    uni.showToast({ title: patch.archived ? '已归档，可在归档中恢复' : '名称已更新', icon: 'none' });
    return true;
  } catch (err) {
    if (session === sessionVersion()) {
      const message = err instanceof Error ? err.message : '操作失败，请重试';
      uni.showToast({ title: message, icon: 'none' });
    }
    return false;
  } finally { actionItem.value = null; }
}
</script>
<template>
  <view v-if="open" class="drawer-layer">
    <view class="scrim" aria-label="关闭学习菜单" @touchmove.stop.prevent @tap="emit('close')" />
    <view class="drawer">
      <view class="brand-row">
        <view><view class="brand">Luma<text class="brand-dot">.</text></view><text class="subtitle">留一点时间，想明白。</text></view>
        <button class="drawer-button close" aria-label="关闭学习菜单" @tap="emit('close')"><LumaIcon name="close" :size="18" /></button>
      </view>
      <button class="drawer-button nav-row" @tap="emit('new')"><LumaIcon name="plus" /><text>新建对话</text></button>
      <button class="drawer-button nav-row" @tap="navigate('/pages/notebook/index', true)"><LumaIcon name="bookmark" /><text>我的错题本</text></button>
      <view class="history-head">
        <text>最近学习</text>
        <button class="drawer-button fold" :aria-label="expanded ? '收起学习历史' : '展开学习历史'" @tap="expanded = !expanded"><LumaIcon :name="expanded ? 'chevron-up' : 'chevron-down'" :size="15" /></button>
      </view>
      <view v-if="expanded" class="history-area">
        <scroll-view scroll-y enhanced :bounces="false" :show-scrollbar="false" class="history-list">
          <view class="history-content">
            <view v-if="history.loading && !history.items.length" class="list-state">正在找回你的学习记录…</view>
            <view v-if="history.error" class="list-state error"><text>{{ history.error }}</text><button class="drawer-button retry" :disabled="history.loading" @tap="history.load()">重新加载</button></view>
            <view v-else-if="history.loaded && !history.items.length" class="list-state">还没有学习对话<text class="empty-note">新的问题，会在这里留下思路。</text></view>
            <view v-for="group in groups" :key="group.label">
              <view class="history-date">{{ group.label }}</view>
              <view v-for="item in group.items" :key="item.id" class="history-row">
                <button class="drawer-button history-item" :disabled="actionItem === item.id" @tap="emit('select', item.id)">
                  <view class="history-title">{{ item.title }}</view><text class="history-time">{{ activityTime(item.lastActiveAt) }}</text>
                </button>
                <button class="drawer-button history-more" :disabled="Boolean(actionItem)" :aria-label="`管理对话：${item.title}`" @tap="manage(item.id)"><LumaIcon name="more" :size="17" /></button>
              </view>
            </view>
            <button v-if="history.nextCursor" class="drawer-button load-more" :disabled="history.loading" @tap="history.load(true)">{{ history.loading ? '正在加载…' : '更早的学习记录' }}</button>
          </view>
        </scroll-view>
      </view>
      <view v-else class="collapsed-space" />
      <view class="drawer-footer">
        <button class="drawer-button archive-row" @tap="navigate('/pages/archived/index')"><LumaIcon name="archive" :size="19" /><text>已归档对话</text></button>
        <button class="drawer-button profile" @tap="emit('close'); emit('account')">
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
.drawer { position:absolute; left:0; top:0; bottom:0; width:78%; max-width:600rpx; box-sizing:border-box; display:flex; flex-direction:column; padding:48rpx 38rpx max(36rpx, env(safe-area-inset-bottom)); background:#f7f8f2; box-shadow:20rpx 0 80rpx rgba(35,50,31,.04); }
.drawer .drawer-button { margin:0; padding:0; text-align:left; border:0; background:transparent; line-height:1.5; font-weight:400; }
.drawer .drawer-button::after { border:0; }
.brand-row { display:flex; align-items:flex-start; justify-content:space-between; gap:16rpx; margin:0 4rpx 48rpx; flex-shrink:0; }
.brand { font:58rpx/1 Georgia,serif; color:#304235; letter-spacing:-1.6rpx; }
.brand-dot { color:#aa916d; }
.subtitle { display:block; margin-top:18rpx; font-size:20rpx; letter-spacing:1rpx; color:#899180; }
.drawer .close { display:flex; align-items:center; justify-content:center; width:72rpx; height:72rpx; margin-top:-14rpx; }
.drawer .nav-row { display:flex; align-items:center; gap:26rpx; width:100%; min-height:96rpx; padding:0 20rpx; box-sizing:border-box; color:#405443; font-size:28rpx; flex-shrink:0; }
.nav-row:active,.history-item:active { background:#edf1e6; border-radius:16rpx; }
.history-head { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; margin-top:36rpx; padding:24rpx 20rpx 6rpx; border-top:1rpx solid #e4e8dc; font-size:22rpx; color:#909888; }
.drawer .fold { display:flex; align-items:center; justify-content:center; width:60rpx; height:60rpx; }
.history-area,.collapsed-space { flex:1; min-height:0; position:relative; overflow:hidden; }
.history-list { position:absolute; inset:0; width:100%; height:100%; }
.history-content { display:flex; flex-direction:column; }
.history-date { margin:26rpx 22rpx 10rpx; color:#a2aa98; font-size:18rpx; }
.history-row { display:flex; align-items:center; min-width:0; }
.drawer .history-item { display:block; flex:1; min-width:0; padding:20rpx 0 20rpx 22rpx; box-sizing:border-box; }
.drawer .history-more { display:flex; align-items:center; justify-content:center; flex-shrink:0; width:80rpx; height:88rpx; color:#8a987e; }
.history-title { display:block; width:100%; min-width:0; color:#54654d; font-size:24rpx; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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
