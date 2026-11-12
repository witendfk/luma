<script setup lang="ts">
import { computed, ref } from 'vue';
interface TopicRoot {
  intent?: string; activeTopicId?: string; learnAll?: boolean;
  topics?: Array<{ id: string; title: string; confirmedAt?: string | null; lesson?: unknown; practice?: unknown; messages?: unknown[]; started?: boolean }>;
}
import LumaIcon from './LumaIcon.vue';
import StudyText from './StudyText.vue';
import { studyPreview } from '@/utils/study-content';
const props = defineProps<{ root: TopicRoot; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'select', id: string): void; (e: 'all'): void }>();
const open = ref(false);
const topics = computed(() => props.root.topics ?? []);
const index = computed(() => Math.max(0, topics.value.findIndex((topic) => topic.id === props.root.activeTopicId)));
const unit = computed(() => props.root.intent === 'knowledge' ? '部分' : '题');
function select(id: string): void { open.value = false; emit('select', id); }
</script>
<template>
  <view class="topic-navigation">
    <button class="topic-current" :disabled="disabled" :class="{ disabled }" aria-label="切换当前学习内容" @tap="open = true"><view class="topic-copy"><text class="focus-label">{{ root.intent === 'knowledge' ? '正在理解' : root.intent === 'practice' ? '当前参考题' : '正在学习' }} · 第 {{ index + 1 }} {{ unit }} / 共 {{ topics.length }} {{ unit }}</text><text class="focus-title">{{ studyPreview(topics[index]?.title ?? "") }}</text></view><text class="switch-label">切换</text></button>
    <view v-if="open" class="topic-layer"><view class="topic-scrim" @tap="open = false" /><view class="topic-sheet"><view class="sheet-heading"><view><text class="sheet-title">{{ root.intent === 'knowledge' ? '想先理解哪一部分？' : '这次先看哪一道？' }}</text><text class="sheet-note">切换会保留各自的草稿和学习进度</text></view><button class="close" aria-label="关闭题目列表" @tap="open = false"><LumaIcon name="close" :size="18" /></button></view><scroll-view class="topic-list" scroll-y :show-scrollbar="false"><button v-for="(topic, i) in topics" :key="topic.id" class="topic-row" :disabled="disabled" :class="{ selected: topic.id === root.activeTopicId }" @tap="select(topic.id)"><text class="topic-number">{{ String(i + 1).padStart(2, '0') }}</text><view class="row-copy"><view class="row-title"><StudyText :text="topic.title" /></view><text class="row-status">{{ topic.confirmedAt ? topic.lesson || topic.practice || (topic.started || topic.messages?.length) ? '已开始 · 可继续' : '已核对' : '待核对' }}</text></view><text class="selected-dot">{{ topic.id === root.activeTopicId ? '●' : '' }}</text></button></scroll-view><button class="all-link" :disabled="disabled" @tap="open = false; emit('all')">{{ root.learnAll ? '已安排逐项学习 · 继续当前内容' : '这些都想学，按顺序来' }}</button><text class="sheet-note bottom-note">每次只处理当前内容，切换不会自动生成讲解。</text></view></view>
  </view>
</template>
<style scoped>
.topic-navigation { flex-shrink:0; border-bottom:1rpx solid #e0e6d7; }
.topic-current,.close,.topic-row,.all-link { display:flex; align-items:center; margin:0; padding:0; border:0; border-radius:0; background:transparent; line-height:1.7; font-weight:400; }
.topic-current::after,.close::after,.topic-row::after,.all-link::after { border:0; }
.topic-current { justify-content:space-between; gap:20rpx; width:100%; padding:18rpx 32rpx; box-sizing:border-box; min-height:112rpx; text-align:left; }
.topic-current.disabled { opacity:.6; }
.topic-copy { flex:1; min-width:0; }
.focus-label { display:block; color:#9da58c; font-size:19rpx; }
.focus-title { display:block; margin-top:6rpx; color:#5d7751; font-size:25rpx; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.switch-label { color:#8a9c78; font-size:22rpx; flex-shrink:0; }
.topic-layer { position:fixed; inset:0; z-index:130; }
.topic-scrim { position:absolute; inset:0; background:rgba(38,51,40,.24); }
.topic-sheet { position:absolute; bottom:0; left:0; right:0; padding:30rpx 36rpx max(36rpx,env(safe-area-inset-bottom)); background:#fbfaf5; border-radius:28rpx 28rpx 0 0; }
.sheet-heading { display:flex; align-items:center; justify-content:space-between; gap:20rpx; margin-bottom:24rpx; }
.sheet-title { display:block; font-family:'Songti SC','STSong',serif; color:#435c3c; font-size:34rpx; }
.sheet-note { display:block; margin-top:12rpx; color:#a0a98f; font-size:21rpx; line-height:1.8; }
.close { justify-content:center; width:80rpx; height:80rpx; }
.topic-list { max-height:48vh; }
.topic-row { width:100%; min-height:128rpx; gap:24rpx; text-align:left; border-top:1rpx solid #e4e8dc; }
.topic-number { color:#ad9879; font-family:Georgia,serif; font-size:25rpx; }
.row-copy { flex:1; min-width:0; }
.row-title { display:block; color:#88987a; font-size:27rpx; }
.selected .row-title { color:#47653e; }
.row-status { display:block; margin-top:8rpx; color:#a6ae98; font-size:20rpx; }
.selected-dot { color:#91a27d; font-size:16rpx; width:24rpx; }
.all-link { min-height:94rpx; color:#69845b; font-size:25rpx; }
.bottom-note { margin-top:0; }
</style>
