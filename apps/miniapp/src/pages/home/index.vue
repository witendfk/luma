<script setup lang="ts">
import AttachmentStrip from '@/components/AttachmentStrip.vue';
import { chooseAttachments, MAX_IMAGES, type LocalAttachment } from '@/utils/attachments';
import { createAttachmentPreview, previewRoot } from '@/mocks/workspace';
import PreviewNotice from '@/components/PreviewNotice.vue';
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import AccountPanel from '@/components/AccountPanel.vue';
import LearningHeader from '@/components/LearningHeader.vue';
import LearningDrawer from '@/components/LearningDrawer.vue';
import LumaIcon from '@/components/LumaIcon.vue';
import { useAuthStore } from '@/stores/auth';
import { useHistoryStore } from '@/stores/history';
import { useConversationStore } from '@/stores/conversation';
import { getToken, onSessionCleared } from '@/utils/token';
import { UI_MOCK } from '@/config';
import { previewContinuation } from '@/utils/continuation';

const auth = useAuthStore();
const history = useHistoryStore();
const conversation = useConversationStore();
const draft = ref('');
const attachments = ref<LocalAttachment[]>([]);
const choosing = ref(false), invalidImage = ref(false);
let sentUploadId: string | null = null;
const menuOpen = ref(false);
const accountOpen = ref(false);
const focused = ref(false);
const navigating = ref(false);
const scenario = ref<'question' | 'knowledge' | 'practice'>('question');
const contentScrollTop = ref(0);
const draftKey = UI_MOCK ? 'luma_ui_draft:home' : 'luma_draft:home';
let sentDraft: string | null = null;
let sentMessage = '';
const greeting = computed(() => `你好，${auth.nickname || '同学'}`);
const placeholder = computed(() => scenario.value === 'knowledge' ? '想弄懂什么？说说困惑，也可以添加课本或笔记…' : scenario.value === 'practice' ? '想练什么？也可以添加参考题…' : '写下问题，或添加题目、课本与笔记图片…');
const modeLabel = computed(() => scenario.value === 'knowledge' ? '讲知识点' : scenario.value === 'practice' ? '出练习' : '');
const continuation = computed(() => history.latest && UI_MOCK ? previewContinuation(history.latest.id) : null);
function continueLearning(): void {
  if (!history.latest || navigating.value) return;
  if (!continuation.value) { openConversation(history.latest.id); return; }
  const target = continuation.value;
  navigating.value = true;
  uni.navigateTo({ url: target.url, success: () => { if (target.notice) uni.showToast({ title: target.notice, icon: 'none' }); }, fail: () => { navigating.value = false; uni.showToast({ title: '未能打开，学习进度仍保留', icon: 'none' }); } });
}

watch([menuOpen, accountOpen], ([menu, account]) => {
  const pages = getCurrentPages();
  if (pages[pages.length - 1]?.route !== 'pages/home/index') return;
  if (menu || account) uni.hideTabBar({ animation: false, fail: () => undefined });
  else uni.showTabBar({ animation: false, fail: () => undefined });
});
watch(draft, (text) => { if (sentUploadId && previewRoot(sentUploadId)?.text !== text.trim()) sentUploadId = null; try { uni.setStorageSync(draftKey, text); } catch { /* 页面内仍保留输入 */ } });
onScopeDispose(onSessionCleared(() => { draft.value = ''; menuOpen.value = false; sentDraft = null; attachments.value = []; sentUploadId = null; choosing.value = false; }));
onShow(() => {
  navigating.value = false;
  if (!getToken()) { uni.reLaunch({ url: '/pages/login/index' }); return; }
  if (!menuOpen.value && !accountOpen.value) uni.showTabBar({ animation: false, fail: () => undefined });
  if (sentUploadId && previewRoot(sentUploadId)?.recognition === 'ready') { attachments.value = []; draft.value = ''; sentUploadId = null; sentDraft = null; }
  // 首题完成落库后再清除首页输入；失败返回时保留原文，便于继续编辑。
  if (sentDraft !== null && !conversation.error && conversation.subject && conversation.messages.some((message) => message.role === 'user' && message.text === sentMessage)) {
    if (draft.value.trim() === sentDraft) draft.value = '';
    sentDraft = null;
  } else if (!draft.value) {
    try { draft.value = (uni.getStorageSync(draftKey) as string) || ''; } catch { /* 不阻断学习 */ }
  }
  void history.load();
});

onLoad(() => uni.$on('luma:new-chat', newChat));
onUnload(() => uni.$off('luma:new-chat', newChat));

function newChat(): void {
  menuOpen.value = false;
  draft.value = '';
  sentDraft = null; sentUploadId = null; attachments.value = []; invalidImage.value = false;
  scenario.value = 'question';
  focused.value = false;
  contentScrollTop.value = 1;
  void nextTick(() => { contentScrollTop.value = 0; });
}
function chooseScenario(value: 'knowledge' | 'practice'): void {
  scenario.value = value; sentUploadId = null;
  focused.value = false;
  void nextTick(() => { focused.value = true; });
}
async function upload(index?: number, question = false): Promise<void> {
  if (choosing.value || navigating.value) return;
  if (index === undefined && attachments.value.length >= MAX_IMAGES) { uni.showToast({ title: '本次最多添加 3 张图片，可更换或移除', icon: 'none' }); return; }
  choosing.value = true; focused.value = false;
  const session = getToken();
  try {
    const selected = await chooseAttachments(index === undefined ? MAX_IMAGES - attachments.value.length : 1);
    if (!selected?.length || session !== getToken()) return;
    if (index === undefined) attachments.value.push(...selected.slice(0, MAX_IMAGES - attachments.value.length));
    else attachments.value.splice(index, 1, selected[0]!);
    if (question) scenario.value = 'question';
    sentUploadId = null;
  } finally { choosing.value = false; }
}
function send(): void {
  const text = draft.value.trim();
  if ((!text && !attachments.value.length) || navigating.value || choosing.value || invalidImage.value) return;
  if (!getToken()) { uni.reLaunch({ url: '/pages/login/index' }); return; }
  navigating.value = true;
  focused.value = false;
  sentDraft = text;
  if (attachments.value.length) {
    if (!UI_MOCK) { navigating.value = false; uni.showToast({ title: '图片识别尚未接通，请先输入题目或知识点', icon: 'none' }); return; }
    try {
      const id = sentUploadId ?? createAttachmentPreview(attachments.value, text, scenario.value);
      sentUploadId = id;
      uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(id)}`, fail: () => { navigating.value = false; uni.showToast({ title: '未能打开，附件和文字已保留', icon: 'none' }); } });
    } catch { navigating.value = false; uni.showToast({ title: '未能保存，附件和文字已保留', icon: 'none' }); }
    return;
  }
  // 练习入口保留明确意图；对话页仍先核对知识范围，再进入生成。
  const initial = text;
  sentMessage = initial;
  uni.navigateTo({
    url: `/pages/chat/index?text=${encodeURIComponent(initial)}&type=${scenario.value === 'question' ? 'question' : 'knowledge'}&intent=${scenario.value}`,
    fail: () => { navigating.value = false; sentDraft = null; uni.showToast({ title: '打开对话失败，请重试', icon: 'none' }); },
  });
}
function openConversation(id: string): void {
  if (navigating.value) return;
  navigating.value = true;
  menuOpen.value = false;
  uni.navigateTo({ url: `/pages/chat/index?id=${id}`, fail: () => { navigating.value = false; uni.showToast({ title: '打开对话失败，请重试', icon: 'none' }); } });
}
</script>

<template>
  <view class="home-page">
    <LearningHeader @menu="menuOpen = true" @new="newChat" />
    <PreviewNotice />
    <scroll-view class="home-content" scroll-y enhanced :bounces="false" :show-scrollbar="false" :scroll-top="contentScrollTop">
    <view class="hero">
      <text class="emblem">✳</text>
      <view class="greeting">{{ greeting }}</view>
      <text class="lede">先想一步，再懂一点。把卡住的那一步交给我。</text>
      <view class="composer">
        <view v-if="modeLabel" class="mode-row"><text>{{ modeLabel }}</text><button aria-label="切换为普通提问" @tap="scenario = 'question'"><LumaIcon name="close" :size="12" /></button></view>
        <AttachmentStrip :images="attachments" @replace="upload($event)" @remove="attachments.splice($event, 1); sentUploadId = null" @invalid="invalidImage = $event" />
        <textarea v-model="draft" class="input" :maxlength="2000" :placeholder="placeholder" placeholder-style="color:#a0ad92;font-size:14px" :focus="focused" :cursor-spacing="24" :show-confirm-bar="false" :adjust-position="true" :disabled="menuOpen" @blur="focused = false" />
        <view class="composer-bar">
          <button class="upload" @tap="upload()"><LumaIcon name="plus" :size="14" /><text>添加附件</text></button>
          <button class="send" :disabled="(!draft.trim() && !attachments.length) || navigating || choosing || invalidImage" aria-label="发送问题" @tap="send"><LumaIcon name="arrow-up" white :size="21" /></button>
        </view>
      </view>
      <text v-if="attachments.length" class="attachment-note">{{ attachments.length }}/3 张图片 · 可以包含多道题</text>
      <view class="quick-entries">
        <button class="quick-entry" @tap="upload(undefined, true)"><LumaIcon name="photo" :size="20" /><text>拍题求助</text></button>
        <button class="quick-entry" :class="{ selected: scenario === 'knowledge' }" @tap="chooseScenario('knowledge')"><LumaIcon name="book" :size="20" /><text>讲知识点</text></button>
        <button class="quick-entry" :class="{ selected: scenario === 'practice' }" @tap="chooseScenario('practice')"><LumaIcon name="practice" :size="20" /><text>出练习</text></button>
      </view>
      <view class="guidance"><view class="soft-dot" /><text>先给提示，陪你一步步想明白</text></view>
      <view v-if="history.latest" class="continue-card">
        <view class="continue-icon"><LumaIcon name="arrow-diagonal" :size="20" /></view>
        <view class="continue-copy"><text class="continue-label">{{ continuation?.label ?? '继续上次的学习' }}</text><view class="continue-title">{{ history.latest.title }}</view></view>
        <button class="continue-action" @tap="continueLearning">继续学习</button>
      </view>
      <view v-if="history.error" class="history-error"><text>学习记录暂时未能加载</text><button :disabled="history.loading" @tap="history.load()">重试</button></view>
    </view>
    </scroll-view>
    <AccountPanel :open="accountOpen" @close="accountOpen = false" />
    <LearningDrawer :open="menuOpen" @account="accountOpen = true" @close="menuOpen = false" @new="newChat" @select="openConversation" />
  </view>
</template>

<style scoped lang="scss">
.home-page { display:flex; flex-direction:column; height:100vh; overflow:hidden; box-sizing:border-box; background:#f8f7f2; color:#354a37; }
.home-content { flex:1; height:0; min-height:0; }
.home-page button { margin:0; padding:0; border:0; background:transparent; line-height:1.5; font-weight:400; }
.home-page button::after { border:0; }
.hero { padding:46rpx 50rpx 48rpx; text-align:center; }
.emblem { display:block; font-size:64rpx; line-height:1; color:#91a27c; margin:10rpx 0 30rpx; }
.greeting { font-family:'Songti SC','STSong',serif; font-size:54rpx; line-height:1.5; letter-spacing:2rpx; }
.lede { display:block; margin:22rpx -8rpx 42rpx; font-size:22rpx; line-height:1.95; color:#96a287; }
.composer { padding:24rpx 28rpx 22rpx; border:1rpx solid #dfe6d5; border-radius:34rpx; background:#fffefa; text-align:left; }
.input { box-sizing:border-box; width:100%; height:168rpx; font-size:30rpx; line-height:1.75; color:#405443; }
.input-placeholder { color:#a0ad92; font-size:27rpx; }
.composer-bar { display:flex; align-items:center; justify-content:space-between; margin-top:16rpx; }
.home-page .upload { display:flex; align-items:center; gap:4rpx; min-height:72rpx; font-size:23rpx; color:#788674; }
.home-page .send { display:flex; align-items:center; justify-content:center; width:72rpx; height:72rpx; border-radius:50%; background:#4f6652; flex-shrink:0; }
.home-page .send[disabled] { background:#b9c4b2; }
.attachment-note { display:block; margin-top:14rpx; color:#9ca78f; font-size:20rpx; text-align:left; }
.quick-entries { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12rpx; margin-top:24rpx; }
.home-page .quick-entry { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14rpx; min-width:0; min-height:116rpx; font-size:23rpx; color:#78886c; white-space:nowrap; }
.home-page .quick-entry.selected { color:#405b3c; }
.mode-row { display:flex; align-items:center; gap:14rpx; margin-bottom:12rpx; font-size:21rpx; color:#7c8b6d; }
.mode-row button { display:flex; align-items:center; justify-content:center; width:44rpx; height:44rpx; }
.guidance { display:flex; justify-content:center; align-items:center; gap:9rpx; margin-top:24rpx; color:#8b9a7e; font-size:20rpx; }
.soft-dot { width:8rpx; height:8rpx; border-radius:50%; background:#91a27c; }
.continue-card { display:flex; align-items:center; gap:20rpx; border-top:1rpx solid #e3e9da; margin-top:38rpx; padding-top:40rpx; text-align:left; }
.continue-icon { display:flex; align-items:center; justify-content:center; width:66rpx; height:66rpx; border-radius:50%; background:#edf1e4; flex-shrink:0; }
.continue-copy { flex:1; min-width:0; }
.continue-label { display:block; color:#939e87; font-size:19rpx; }
.continue-title { display:block; width:100%; min-width:0; margin-top:9rpx; color:#44543d; font-size:24rpx; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.home-page .continue-action { color:#627b52; font-size:22rpx; padding:20rpx 0 20rpx 6rpx; flex-shrink:0; }
.history-error { display:flex; align-items:center; justify-content:center; gap:16rpx; padding-top:28rpx; font-size:22rpx; color:#9b8874; }
.home-page .history-error button { color:#617754; padding:12rpx; font-size:22rpx; }
@media(max-width:360px) { .hero { padding-left:36rpx; padding-right:36rpx; } .quick-entries { gap:8rpx; } .home-page .quick-entry { font-size:22rpx; gap:12rpx; } }
</style>
