<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import LumaIcon from './LumaIcon.vue';
import MessageBubble from './MessageBubble.vue';
import { useStudyPreviewStore } from '@/stores/study-preview';
const study = useStudyPreviewStore();
const draft = ref(study.pendingQuestion);
const keyboard = ref(0), expanded = ref(false), scrollTarget = ref('');
watch(draft, (value) => study.discussionDraft(value));
const pageHeight = uni.getSystemInfoSync().windowHeight;
const exercise = computed(() => study.example.exercises.find((item) => item.id === study.focus?.id));
const source = computed(() => study.focus?.kind === 'exercise' ? exercise.value?.stem : study.example.sections.find((item) => item.id === study.focus?.id)?.body);
const backLabel = computed(() => study.focus?.kind === 'exercise' ? '返回练习' : '返回讲解');
function back(end = false): void {
  const kind = study.focus?.kind;
  if (end) study.endFocus();
  if (getCurrentPages().length > 1) uni.navigateBack();
  else uni.redirectTo({ url: `/pages/${kind === 'exercise' ? 'practice' : 'reader'}/index?preview=1&scope=${encodeURIComponent(study.scope)}` });
}
function send(): void {
  if (!draft.value.trim()) return;
  study.send(draft.value.trim()); draft.value = ''; scrollTarget.value = '';
  void nextTick(() => { scrollTarget.value = 'preview-thread-end'; });
}
</script>

<template>
  <view class="discussion" :style="{ height: Math.max(260, pageHeight - keyboard) + 'px' }">
    <view class="header"><button @tap="back()"><LumaIcon name="chevron-left" :size="17" />{{ backLabel }}</button><text>继续想一想</text><button class="end" @tap="back(true)">结束追问</button></view>
    <view class="preview-label">交互预览 · 示例回复 · 不请求模型或写入正式对话</view>
    <view v-if="study.focus" class="focus-card"><button class="focus-toggle" @tap="expanded = !expanded"><view><text class="focus-label">{{ study.focus.kind === 'exercise' ? '正在问这道题' : '正在问这一段' }}</text><text class="focus-heading">{{ study.focus.heading }}</text></view><LumaIcon :name="expanded ? 'chevron-up' : 'chevron-down'" :size="14" /></button><text v-if="expanded" class="focus-source">{{ source }}</text></view>
    <scroll-view class="thread-scroll" scroll-y :scroll-into-view="scrollTarget">
      <view class="thread"><view v-if="!study.messages.length" class="opening"><text class="emblem">✳</text><text>从没想通的那一步开始。</text><text class="opening-note">问题已带上{{ study.focus?.kind === 'exercise' ? '当前题目' : '讲解段落' }}，可以改一改再发送。</text></view><MessageBubble v-for="message in study.messages" :key="message.id" :role="message.role" :text="message.text" /><view id="preview-thread-end" class="thread-end" /></view>
    </scroll-view>
    <view class="input-dock"><view class="composer"><textarea v-model="draft" class="input" :maxlength="2000" :adjust-position="false" :show-confirm-bar="false" placeholder="说说哪里还没想明白…" @keyboardheightchange="keyboard = $event.detail.height" /><view class="composer-bottom"><button class="return" @tap="back()">{{ backLabel }}继续<LumaIcon name="arrow-diagonal" :size="12" /></button><button class="send" :disabled="!draft.trim()" aria-label="发送段落追问" @tap="send"><LumaIcon name="arrow-up" white :size="21" /></button></view></view></view>
  </view>
</template>

<style scoped>
.discussion { display:flex; flex-direction:column; overflow:hidden; color:#40543e; background:#f8f7f2; }
.discussion button { margin:0; padding:0; background:transparent; border:0; font-weight:400; line-height:1.6; }
.discussion button::after { border:0; }
.header { display:flex; align-items:center; justify-content:space-between; gap:16rpx; padding:8rpx 24rpx; min-height:84rpx; flex-shrink:0; background:#fafbf7; border-bottom:1rpx solid #e4e8dc; font-size:27rpx; }
.header button { display:flex; align-items:center; gap:4rpx; min-height:80rpx; color:#7e9172; font-size:22rpx; }
.header .end { color:#a2ab97; }
.preview-label { padding:10rpx 20rpx; text-align:center; color:#9e8b70; background:#f4efe5; font-size:19rpx; flex-shrink:0; }
.focus-card { padding:16rpx 32rpx; border-bottom:1rpx solid #e2e8d8; flex-shrink:0; }
.focus-toggle { width:100%; display:flex; align-items:center; justify-content:space-between; gap:16rpx; text-align:left; }
.focus-toggle>view { min-width:0; flex:1; }
.focus-label { display:block; color:#a1ac93; font-size:19rpx; }
.focus-heading { display:block; margin-top:6rpx; color:#69845b; font-size:24rpx; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.focus-source { display:block; margin:16rpx 0; max-height:220rpx; overflow:auto; color:#8a9a7e; font-size:24rpx; line-height:1.8; white-space:pre-wrap; }
.thread-scroll { flex:1; height:0; min-height:0; }
.thread { padding:36rpx 32rpx 0; }
.opening { display:flex; flex-direction:column; align-items:center; gap:20rpx; padding:52rpx 20rpx; color:#6e855e; font-size:28rpx; text-align:center; }
.emblem { color:#9aac8b; font-size:46rpx; }
.opening-note { color:#a0ac93; font-size:22rpx; line-height:1.8; }
.thread-end { height:20rpx; }
.input-dock { padding:14rpx 24rpx max(24rpx,env(safe-area-inset-bottom)); flex-shrink:0; }
.composer { padding:22rpx 26rpx 18rpx; border:1rpx solid #dce4d2; border-radius:34rpx; background:#fffefa; }
.input { width:100%; height:140rpx; font-size:28rpx; line-height:1.8; color:#40543e; }
.composer-bottom { display:flex; align-items:center; justify-content:space-between; margin-top:14rpx; }
.composer-bottom .return { display:flex; align-items:center; gap:12rpx; color:#8e9f80; min-height:80rpx; font-size:22rpx; }
.composer-bottom .send { display:flex; align-items:center; justify-content:center; width:72rpx; height:72rpx; background:#4f6652; border-radius:50%; }
.composer-bottom .send[disabled] { opacity:.45; }
</style>
