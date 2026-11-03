<script setup lang="ts">
import PreviewNotice from '@/components/PreviewNotice.vue';
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import LumaIcon from '@/components/LumaIcon.vue';
import { useArchivedStore } from '@/stores/archived';
import { activityTime } from '@/utils/history';
import { getToken, sessionVersion } from '@/utils/token';

const archive = useArchivedStore();
const opening = ref(false);
onShow(() => {
  opening.value = false;
  if (!getToken()) { uni.reLaunch({ url: '/pages/login/index' }); return; }
  void archive.load();
});
function open(id: string): void {
  if (opening.value || archive.restoringId === id) return;
  opening.value = true;
  uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(id)}`, fail: () => { opening.value = false; uni.showToast({ title: '打开失败，请重试', icon: 'none' }); } });
}
async function restore(id: string): Promise<void> {
  const session = sessionVersion();
  try {
    if (await archive.restore(id)) uni.showToast({ title: '已恢复到最近学习', icon: 'none' });
  } catch (err) {
    if (session === sessionVersion()) uni.showToast({ title: err instanceof Error ? err.message : '恢复失败，请重试', icon: 'none' });
  }
}
</script>

<template>
  <view class="archive-page">
    <PreviewNotice />
    <view class="intro"><text class="eyebrow">ARCHIVE</text><text class="title">暂时收起，随时拾起。</text><text class="caption">对话和已保存的内容都还在。<br />查看不会恢复，继续提问时会回到最近学习。</text></view>
    <scroll-view class="archive-scroll" scroll-y enhanced :bounces="false" :show-scrollbar="false" @scrolltolower="archive.load(true)">
      <view class="archive-content">
        <view v-if="archive.loading && !archive.items.length" class="state"><text>正在找回归档对话…</text></view>
        <view v-else-if="archive.loaded && !archive.items.length && !archive.error" class="state"><LumaIcon name="archive" :size="30" /><text class="empty-title">还没有归档的对话</text><text class="empty-note">在最近学习的「···」中归档，<br />以后也可以从这里继续。</text></view>
        <view v-for="item in archive.items" :key="item.id" class="archive-row">
          <button class="archive-button conversation" :disabled="opening || archive.restoringId === item.id" @tap="open(item.id)"><text class="conversation-title">{{ item.title }}</text><text class="conversation-time">{{ activityTime(item.archivedAt || item.lastActiveAt) }} 归档</text></button>
          <button class="archive-button restore" :disabled="Boolean(archive.restoringId)" :aria-label="`恢复对话：${item.title}`" @tap="restore(item.id)">{{ archive.restoringId === item.id ? '恢复中…' : '恢复' }}</button>
        </view>
        <view v-if="archive.error" class="error"><text>{{ archive.error }}</text><button class="archive-button retry" :disabled="archive.loading" @tap="archive.load()">重新加载</button></view>
        <button v-if="archive.nextCursor && !archive.error" class="archive-button load-more" :disabled="archive.loading" @tap="archive.load(true)">{{ archive.loading ? '正在加载…' : '更早的归档对话' }}</button>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped>
.archive-page { display:flex; flex-direction:column; height:100vh; overflow:hidden; background:#f8f7f2; color:#42563e; }
.intro { padding:48rpx 40rpx 32rpx; flex-shrink:0; }
.eyebrow { display:block; color:#a18d70; font-size:18rpx; letter-spacing:5rpx; }
.title { display:block; margin:22rpx 0 18rpx; font-family:'Songti SC','STSong',serif; font-size:42rpx; line-height:1.6; }
.caption { display:block; font-size:24rpx; color:#94a087; line-height:1.9; }
.archive-scroll { flex:1; height:0; min-height:0; }
.archive-content { padding:0 40rpx max(32rpx, env(safe-area-inset-bottom)); }
.archive-button { margin:0; padding:0; background:transparent; border:0; border-radius:0; line-height:1.6; font-weight:400; }
.archive-button::after { border:0; }
.archive-row { display:flex; align-items:center; gap:24rpx; border-bottom:1rpx solid #e3e8da; }
.conversation { flex:1; min-width:0; padding:30rpx 0; text-align:left; }
.conversation-title { display:block; color:#4a6042; font-size:27rpx; line-height:1.8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.conversation-time { display:block; margin-top:12rpx; color:#a0aa94; font-size:20rpx; }
.restore { display:flex; align-items:center; justify-content:flex-end; min-width:88rpx; min-height:88rpx; flex-shrink:0; color:#718963; font-size:24rpx; }
.restore[disabled] { color:#a8b29b; }
.state { display:flex; flex-direction:column; align-items:center; gap:28rpx; padding:100rpx 20rpx; text-align:center; font-size:25rpx; color:#99a58e; }
.empty-title { font-size:29rpx; color:#708564; }
.empty-note { font-size:23rpx; line-height:1.9; color:#a0aa95; }
.error { padding:40rpx 0; color:#a17459; font-size:24rpx; text-align:center; }
.retry,.load-more { min-height:88rpx; color:#6d845e; font-size:23rpx; }
.load-more { width:100%; margin-top:20rpx; }
</style>
