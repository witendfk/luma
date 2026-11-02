<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import type { TurnRequest } from '@luma/shared';
import MessageBubble from '@/components/MessageBubble.vue';
import LearningHeader from '@/components/LearningHeader.vue';
import LearningDrawer from '@/components/LearningDrawer.vue';
import AccountPanel from '@/components/AccountPanel.vue';
import LumaIcon from '@/components/LumaIcon.vue';
import { saveCollection } from '@/api/collections';
import { useConversationStore } from '@/stores/conversation';

const store = useConversationStore();
const draft = ref('');
const busy = ref(false);
const menuOpen = ref(false);
const accountOpen = ref(false);
const saved = ref(false);
const saving = ref(false);
const pageHeight = uni.getSystemInfoSync().windowHeight;
const keyboardHeight = ref(0);
const scrollTarget = ref('');
const status = computed(() => store.subject && !store.subject.confirmedAt ? '先核对题目与知识点' : '理解 → 练习 → 对照自评 → 再追问');
const ready = computed(() => Boolean(store.subject?.confirmedAt) && !store.generating);
const lesson = computed(() => store.artifacts.find((item) => item.type === 'lesson' && item.publishStatus === 'published'));
const practice = computed(() => store.artifacts.find((item) => item.type === 'exercise_set' && item.publishStatus === 'published'));
const lastReply = computed(() => [...store.messages].reverse().find((message) => message.role === 'assistant'));
onUnload(() => store.stopStream());
onLoad(async (query) => {
  try {
    if (query?.id) await store.open(query.id);
    else { store.reset(); if (query?.text) await store.send(decodeURIComponent(query.text), undefined, query.type === 'knowledge' ? 'knowledge' : 'question'); }
  } catch (err) { store.error = err instanceof Error ? err.message : '对话加载失败'; }
});
function scrollToEnd(): void {
  scrollTarget.value = '';
  void nextTick(() => { scrollTarget.value = 'thread-end'; });
}
watch(() => store.messages.map((message) => message.text).join('') + Boolean(store.subject), scrollToEnd);
async function onSend(): Promise<void> {
  const text = draft.value.trim();
  if (!text || store.generating) return;
  await store.send(text);
  if (!store.error) draft.value = '';
}
async function onConfirm(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try { await store.confirm(); }
  catch (err) { store.error = err instanceof Error ? err.message : '核对失败'; }
  finally { busy.value = false; }
}
async function onStop(): Promise<void> {
  try { await store.stop(); }
  catch (err) { store.error = err instanceof Error ? err.message : '停止失败'; }
}
function newChat(): void { menuOpen.value = false; uni.switchTab({ url: '/pages/home/index', success: () => uni.$emit('luma:new-chat') }); }
function openConversation(id: string): void {
  menuOpen.value = false;
  if (id === store.currentId) return;
  saved.value = false;
  draft.value = '';
  void store.open(id).catch((err) => { store.error = err.message; });
}
function action(text: string, kind: TurnRequest['action']): void {
  if (!ready.value) return;
  if (kind === 'show_solution') {
    uni.showModal({ title: '查看完整解析', content: '建议先自己推一遍。也可以现在查看，之后再独立试一试。', confirmText: '查看解析', cancelText: '继续思考', confirmColor: '#4f6652', success: (res) => { if (res.confirm) void store.send(text, kind); } });
  } else void store.send(text, kind);
}
function upload(): void { uni.showModal({ title: '上传解题过程', content: '照片上传正在接入。现在可以先写下你的思路，继续向 Luma 提问。', showCancel: false, confirmText: '知道了', confirmColor: '#4f6652' }); }
async function save(): Promise<void> {
  if (!store.currentId || !store.subject?.confirmedAt || saving.value) return;
  saving.value = true;
  try { await saveCollection(store.currentId, {}); saved.value = true; uni.showToast({ title: '已保存学习记录', icon: 'none' }); }
  catch (err) { uni.showToast({ title: err instanceof Error ? err.message : '保存失败，请重试', icon: 'none' }); }
  finally { saving.value = false; }
}
function openMaterial(type: 'lesson' | 'practice'): void {
  const artifact = type === 'lesson' ? lesson.value : practice.value;
  if (artifact) uni.navigateTo({ url: `/pages/${type === 'lesson' ? 'reader' : 'practice'}/index?artifactId=${artifact.id}&conversationId=${store.currentId}` });
  else action(type === 'lesson' ? '请生成图文讲解' : '请出同知识点练习', type === 'lesson' ? 'generate_lesson' : 'generate_practice');
}
</script>

<template>
  <view class="chat-page" :style="{ height: Math.max(250, pageHeight - keyboardHeight) + 'px' }">
    <LearningHeader :title="store.title || '新建对话'" @menu="menuOpen = true" @new="newChat" />
    <view class="task-toolbar">
      <text class="stage">{{ status }}</text>
      <view class="toolbar-actions">
        <button :disabled="!store.subject?.confirmedAt || saving" @tap="save"><LumaIcon name="star" :size="12" /><text>{{ saved ? '已保存' : '保存错题' }}</text></button>
        <button :disabled="!store.subject?.confirmedAt" @tap="openMaterial('lesson')"><text>图文讲解</text><LumaIcon name="arrow-diagonal" :size="12" /></button>
      </view>
    </view>
    <scroll-view class="thread-scroll" scroll-y :scroll-into-view="scrollTarget" :scroll-with-animation="true">
      <view class="thread">
        <view v-if="!store.messages.length" class="empty"><text class="empty-symbol">✳</text><text>从你卡住的那一步，开始。</text><text class="empty-caption">写下题目或知识点，我陪你一起想。</text></view>
        <MessageBubble v-for="msg in store.messages" :key="msg.id" :role="msg.role" :text="msg.text" :incomplete="msg.incomplete" />
        <view v-if="store.subject && !store.subject.confirmedAt" class="confirmation">
          <view class="card-heading"><text>核对题目与知识点</text><text class="revision">待确认</text></view>
          <text class="subject-text" selectable>{{ store.subject.content.text }}</text>
          <view v-if="store.subject.tags.length" class="tags"><text v-for="tag in store.subject.tags" :key="tag">{{ tag }}</text></view>
          <text class="check-note">先确认题干、公式和已知条件，我们再开始。</text>
          <button class="confirm-action" :disabled="busy || store.generating" @tap="onConfirm">{{ busy ? '正在确认…' : '内容正确，开始学习' }}</button>
        </view>
        <view v-if="ready && lastReply && !store.error" class="follow-actions">
          <button @tap="action('没思路，请给我一个方向提示', 'hint')">再给一点提示<text>›</text></button>
          <button @tap="action('我想查看完整解析', 'show_solution')">查看完整解析<text>›</text></button>
          <button @tap="openMaterial('lesson')">图文讲解<text>›</text></button>
        </view>
        <view v-if="lesson || practice" class="resources">
          <button v-if="lesson" class="resource" @tap="openMaterial('lesson')"><view><text class="resource-title">图文讲解</text><text class="resource-caption">概念图解 · 分步推导 · 易错辨析</text></view><LumaIcon name="arrow-diagonal" :size="16" /></button>
          <button v-if="practice" class="resource" @tap="openMaterial('practice')"><view><text class="resource-title">同知识点配套练习</text><text class="resource-caption">独立思考，再对照解析与自评</text></view><LumaIcon name="arrow-diagonal" :size="16" /></button>
        </view>
        <view v-if="store.generating" class="progress-state"><view class="pulse" /><text>Luma 正在整理思路…</text></view>
        <view v-if="store.waitingJob" class="progress-state"><view class="pulse" /><text>学习材料正在生成，你可以继续提问。</text></view>
        <view v-if="store.error" class="error"><text>{{ store.error }}</text><text class="error-caption">已完成的对话仍会保留。</text></view>
        <button v-if="store.generating || store.waitingJob" class="stop" @tap="onStop">停止本次生成</button>
        <view id="thread-end" class="thread-end" />
      </view>
    </scroll-view>
    <view class="input-dock">
      <view class="composer">
        <textarea v-model="draft" class="input" :maxlength="2000" placeholder="写下你的思路，或继续追问…" placeholder-style="color:#a0ad92;font-size:14px" :show-confirm-bar="false" :adjust-position="false" :disabled="menuOpen || accountOpen" @keyboardheightchange="keyboardHeight = $event.detail.height" />
        <view class="composer-bar"><button class="upload" @tap="upload"><LumaIcon name="plus" :size="14" /><text>上传过程</text></button><button class="send" :disabled="!draft.trim() || store.generating" aria-label="发送消息" @tap="onSend"><LumaIcon name="arrow-up" white :size="21" /></button></view>
      </view>
    </view>
    <AccountPanel :open="accountOpen" @close="accountOpen = false" />
    <LearningDrawer :open="menuOpen" @close="menuOpen = false" @new="newChat" @select="openConversation" @account="accountOpen = true" />
  </view>
</template>

<style scoped>
.chat-page { display:flex; flex-direction:column; box-sizing:border-box; background:#f8f7f2; color:#354a37; overflow:hidden; }
.chat-page button { margin:0; padding:0; border:0; background:transparent; font-weight:400; line-height:1.6; }
.chat-page button::after { border:0; }
.task-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12rpx; min-height:74rpx; padding:0 32rpx; border-bottom:1rpx solid #e4e8dc; background:#fafbf5; flex-shrink:0; }
.stage { max-width:49%; font-size:18rpx; color:#8c9c7e; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.toolbar-actions { display:flex; align-items:center; gap:24rpx; }
.toolbar-actions button { display:flex; align-items:center; gap:5rpx; min-height:72rpx; color:#718661; font-size:20rpx; white-space:nowrap; }
.toolbar-actions button[disabled] { opacity:.45; }
.thread-scroll { flex:1; height:0; min-height:0; }
.thread { padding:36rpx 32rpx 0; }
.empty { display:flex; flex-direction:column; align-items:center; gap:24rpx; padding:100rpx 20rpx; font-size:28rpx; color:#6a7d5d; }
.empty-symbol { font-size:48rpx; color:#92a27c; }
.empty-caption { font-size:23rpx; color:#a1ad94; }
.confirmation { margin:0 0 40rpx 68rpx; padding:28rpx; border:1rpx solid #dfe5d5; border-radius:22rpx; background:#fffefa; }
.card-heading { display:flex; justify-content:space-between; gap:14rpx; font-size:25rpx; color:#54694b; }
.revision { font-size:19rpx; color:#a38b69; flex-shrink:0; padding-top:4rpx; }
.subject-text { display:block; margin:22rpx 0; white-space:pre-wrap; overflow-wrap:anywhere; font-size:27rpx; line-height:1.9; color:#3e4a37; }
.tags { display:flex; gap:12rpx; flex-wrap:wrap; margin-bottom:20rpx; }
.tags text { padding:5rpx 12rpx; background:#edf2e6; border-radius:8rpx; font-size:20rpx; color:#81946f; }
.check-note { display:block; font-size:21rpx; color:#9aa58c; line-height:1.8; }
.chat-page .confirm-action { width:100%; min-height:80rpx; margin-top:25rpx; padding:14rpx 12rpx; box-sizing:border-box; border-radius:44rpx; color:#fffefa; background:#4f6652; font-size:24rpx; }
.chat-page .confirm-action[disabled] { opacity:.5; }
.follow-actions { display:flex; gap:12rpx 30rpx; flex-wrap:wrap; margin:-18rpx 0 30rpx 68rpx; }
.follow-actions button { display:flex; align-items:center; gap:9rpx; min-height:76rpx; color:#829272; font-size:22rpx; }
.follow-actions button text { color:#a1ad95; }
.resources { margin:0 0 24rpx 68rpx; }
.chat-page .resource { display:flex; align-items:center; justify-content:space-between; gap:16rpx; width:100%; border-bottom:1rpx solid #e0e6d7; padding:26rpx 0; text-align:left; }
.resource-title { display:block; font-size:26rpx; color:#54694b; }
.resource-caption { display:block; font-size:21rpx; color:#99a28c; margin-top:10rpx; line-height:1.8; }
.progress-state { display:flex; align-items:center; gap:14rpx; padding:20rpx 0 24rpx 68rpx; color:#94a086; font-size:23rpx; }
.pulse { width:10rpx; height:10rpx; background:#91a27c; border-radius:50%; }
.error { margin:12rpx 0 16rpx 68rpx; padding:22rpx; background:#f4eee5; border-radius:16rpx; color:#a47d61; font-size:24rpx; }
.error-caption { display:block; margin-top:9rpx; color:#a59a88; font-size:20rpx; }
.chat-page .stop { color:#a08464; font-size:22rpx; padding:16rpx; }
.thread-end { height:20rpx; }
.input-dock { padding:14rpx 24rpx max(24rpx,env(safe-area-inset-bottom)); flex-shrink:0; background:#f8f7f2; }
.composer { padding:22rpx 26rpx 18rpx; border:1rpx solid #dde5d1; border-radius:38rpx; background:#fffefa; }
.input { box-sizing:border-box; width:100%; height:76rpx; max-height:180rpx; font-size:29rpx; line-height:1.75; color:#405443; }
.composer-bar { display:flex; align-items:center; justify-content:space-between; margin-top:8rpx; }
.chat-page .upload { display:flex; align-items:center; gap:6rpx; min-height:72rpx; font-size:22rpx; color:#8e9b81; }
.chat-page .send { display:flex; align-items:center; justify-content:center; width:72rpx; height:72rpx; flex-shrink:0; background:#4f6652; border-radius:50%; }
.chat-page .send[disabled] { background:#b9c4b2; }
</style>
