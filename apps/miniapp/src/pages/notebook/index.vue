<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { UI_MOCK } from '@/config';
import PreviewNotice from '@/components/PreviewNotice.vue';
import LumaIcon from '@/components/LumaIcon.vue';
import { useNotebookPreviewStore } from '@/stores/notebook-preview';
const notebook = useNotebookPreviewStore();
onShow(() => { if (UI_MOCK) notebook.refresh(); });
const views = [{ id: 'question' as const, label: '错题' }, { id: 'lesson' as const, label: '讲解' }, { id: 'practice' as const, label: '练习' }];
const states = [{ id: 'all' as const, label: '全部' }, { id: 'to_review' as const, label: '待复习' }, { id: 'reviewed' as const, label: '已复习' }];
function open(id: string): void { uni.navigateTo({ url: `/pages/notebook/detail?id=${encodeURIComponent(id)}` }); }
function goHome(): void { uni.switchTab({ url: '/pages/home/index' }); }
function clear(): void { notebook.keyword = ''; notebook.status = 'all'; }
</script>
<template>
  <view class="notebook-page">
    <PreviewNotice />
    <view class="heading"><text class="eyebrow">MY NOTEBOOK</text><view class="title-row"><text class="title">把想明白的，留下来。</text><text class="count">{{ UI_MOCK ? notebook.collected.length : 0 }} 条</text></view><text class="caption">留住卡住的地方，也留住自己的理解。</text></view>
    <view v-if="UI_MOCK" class="tools">
      <view class="search"><LumaIcon name="search" :size="18" /><input v-model="notebook.keyword" class="search-input" placeholder="搜索题目或知识点" confirm-type="search" /><button v-if="notebook.keyword" class="quiet clear" aria-label="清空搜索" @tap="notebook.keyword = ''"><LumaIcon name="close" :size="14" /></button></view>
      <view class="views"><button v-for="item in views" :key="item.id" class="quiet view-tab" :class="{ active: notebook.view === item.id }" @tap="notebook.view = item.id">{{ item.label }}</button></view>
      <view class="filters"><view class="status-filters"><button v-for="item in states" :key="item.id" class="quiet filter" :class="{ selected: notebook.status === item.id }" @tap="notebook.status = item.id">{{ item.label }}</button></view><text class="result-count">{{ notebook.visible.length }} 条记录</text></view>
    </view>
    <scroll-view class="records-scroll" scroll-y enhanced :bounces="false" :show-scrollbar="false">
      <view class="records">
        <view v-if="!UI_MOCK" class="empty"><LumaIcon name="bookmark" :size="28" /><text>学习记录交互已准备好</text><text class="empty-note">当前先在前端预览模式定稿，正式数据稍后接入。</text></view>
        <view v-else-if="!notebook.collected.length" class="empty"><LumaIcon name="bookmark" :size="28" /><text>把值得回看的内容留在这里</text><text class="empty-note">在学习对话中点「保存错题」或「保存记录」，<br />就能回来继续阅读和练习。</text><button class="quiet empty-action" @tap="goHome">去学习对话</button></view>
        <view v-else-if="!notebook.visible.length" class="empty"><text>暂时没有匹配的记录</text><text class="empty-note">试试其他关键词，或切换查看视角。</text><button class="quiet empty-action" @tap="clear">清除搜索与复习筛选</button></view>
        <template v-else><button v-for="item in notebook.visible" :key="item.id" class="quiet record" @tap="open(item.id)"><view class="record-meta"><text>{{ item.type === 'knowledge' ? '知识点记录' : '错题记录' }}</text><text :class="{ reviewed: item.reviewStatus === 'reviewed' }">{{ item.reviewStatus === 'reviewed' ? '已复习' : '待复习' }}</text></view><text class="record-title">{{ item.title }}</text><text class="record-stem">{{ item.text }}</text><view class="record-bottom"><text>{{ item.tags.join(' · ') }}</text><view class="materials"><LumaIcon v-if="item.lesson" name="book" :size="14" /><LumaIcon v-if="item.practice" name="practice" :size="14" /></view></view></button></template>
      </view>
    </scroll-view>
  </view>
</template>
<style scoped>
.notebook-page { display:flex; flex-direction:column; height:100vh; overflow:hidden; color:#40553d; background:#f8f7f2; }
.quiet { margin:0; padding:0; border:0; background:transparent; border-radius:0; line-height:1.7; font-weight:400; }
.quiet::after { border:0; }
.heading { padding:40rpx 38rpx 28rpx; flex-shrink:0; }
.eyebrow { display:block; color:#a28c6c; letter-spacing:4rpx; font-size:18rpx; }
.title-row { display:flex; align-items:baseline; gap:12rpx; justify-content:space-between; margin:20rpx 0 16rpx; }
.title { font-family:'Songti SC','STSong',serif; font-size:40rpx; line-height:1.6; }
.count { color:#9aa58e; font-size:21rpx; flex-shrink:0; }
.caption { color:#98a38b; font-size:23rpx; }
.tools { padding:0 38rpx; flex-shrink:0; }
.search { display:flex; align-items:center; gap:16rpx; padding:0 22rpx; height:82rpx; background:#efefe7; border-radius:18rpx; }
.search-input { flex:1; min-width:0; font-size:25rpx; color:#52674a; }
.clear { display:flex; align-items:center; justify-content:center; width:60rpx; height:76rpx; }
.views { display:flex; gap:46rpx; margin-top:24rpx; border-bottom:1rpx solid #e1e7d9; }
.view-tab { position:relative; min-height:88rpx; padding:18rpx 4rpx; color:#a0aa94; font-size:28rpx; }
.view-tab.active { color:#486140; }
.view-tab.active::before { content:''; position:absolute; bottom:0; left:20%; right:20%; height:3rpx; background:#748c64; }
.filters { display:flex; align-items:center; justify-content:space-between; gap:10rpx; }
.status-filters { display:flex; gap:28rpx; }
.filter { display:flex; align-items:center; min-height:82rpx; color:#a3ad97; font-size:22rpx; }
.filter.selected { color:#637c54; }
.result-count { font-size:19rpx; color:#a6af9c; }
.records-scroll { flex:1; height:0; min-height:0; }
.records { padding:0 38rpx max(30rpx,env(safe-area-inset-bottom)); }
.record { display:block; width:100%; text-align:left; padding:30rpx 0; border-bottom:1rpx solid #e2e8d9; }
.record-meta { display:flex; justify-content:space-between; color:#aa987c; font-size:19rpx; }
.record-meta .reviewed { color:#9ca88e; }
.record-title { display:block; margin:16rpx 0 12rpx; font-size:29rpx; color:#435b3d; line-height:1.8; }
.record-stem { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; color:#8d9a81; font-size:24rpx; line-height:1.85; }
.record-bottom { display:flex; justify-content:space-between; gap:20rpx; align-items:center; margin-top:22rpx; color:#9fac92; font-size:20rpx; }
.materials { display:flex; gap:18rpx; }
.empty { display:flex; align-items:center; flex-direction:column; gap:28rpx; padding:90rpx 10rpx; text-align:center; color:#7e9270; font-size:28rpx; }
.empty-note { color:#a0aa94; font-size:23rpx; line-height:1.9; }
.empty-action { min-height:88rpx; color:#71875f; font-size:24rpx; }
</style>
