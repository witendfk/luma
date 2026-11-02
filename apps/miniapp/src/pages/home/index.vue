<script setup lang="ts">
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

const auth = useAuthStore();
const history = useHistoryStore();
const conversation = useConversationStore();
const draft = ref('');
const menuOpen = ref(false);
const accountOpen = ref(false);
const focused = ref(false);
const navigating = ref(false);
const scenario = ref<'question' | 'knowledge' | 'practice'>('question');
const pageHeight = uni.getSystemInfoSync().windowHeight;
const draftKey = 'luma_draft:home';
let sentDraft: string | null = null;
let sentMessage = '';
const greeting = computed(() => `你好，${auth.nickname || '同学'}`);
const placeholder = computed(() => scenario.value === 'knowledge' ? '哪个知识点没听懂？说说你的困惑…' : scenario.value === 'practice' ? '想练哪个知识点？也可以说明难度…' : '拍一道题，或说说哪个知识点没听懂…');
const modeLabel = computed(() => scenario.value === 'knowledge' ? '讲知识点' : scenario.value === 'practice' ? '同知识点练习' : '');

watch([menuOpen, accountOpen], ([menu, account]) => {
  if (menu || account) uni.hideTabBar({ animation: false });
  else uni.showTabBar({ animation: false });
});
watch(draft, (text) => { try { uni.setStorageSync(draftKey, text); } catch { /* 页面内仍保留输入 */ } });
onScopeDispose(onSessionCleared(() => { draft.value = ''; menuOpen.value = false; sentDraft = null; }));
onShow(() => {
  navigating.value = false;
  if (!getToken()) { uni.reLaunch({ url: '/pages/login/index' }); return; }
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
  sentDraft = null;
  scenario.value = 'question';
  focused.value = false;
  uni.pageScrollTo({ scrollTop: 0, duration: 150 });
}
function chooseScenario(value: 'knowledge' | 'practice'): void {
  scenario.value = value;
  focused.value = false;
  void nextTick(() => { focused.value = true; });
}
function upload(): void {
  uni.showModal({ title: '拍题求助', content: '照片上传正在接入。现在可以先输入题目文字，或试一道示例题。', showCancel: false, confirmText: '知道了', confirmColor: '#4f6652' });
}
function send(): void {
  const text = draft.value.trim();
  if (!text || navigating.value) return;
  if (!getToken()) { uni.reLaunch({ url: '/pages/login/index' }); return; }
  navigating.value = true;
  focused.value = false;
  sentDraft = text;
  // 练习入口保留明确意图；对话页仍先核对知识范围，再进入生成。
  const initial = scenario.value === 'practice' ? `请围绕以下内容出同知识点练习：${text}` : text;
  sentMessage = initial;
  uni.navigateTo({
    url: `/pages/chat/index?text=${encodeURIComponent(initial)}&type=${scenario.value === 'question' ? 'question' : 'knowledge'}`,
    fail: () => { navigating.value = false; sentDraft = null; uni.showToast({ title: '打开对话失败，请重试', icon: 'none' }); },
  });
}
function openConversation(id: string): void {
  if (navigating.value) return;
  navigating.value = true;
  menuOpen.value = false;
  uni.navigateTo({ url: `/pages/chat/index?id=${id}`, fail: () => { navigating.value = false; uni.showToast({ title: '打开对话失败，请重试', icon: 'none' }); } });
}
function sample(): void {
  scenario.value = 'question';
  draft.value = '已知 f(x)=x²-2x+3，求 f(x) 的最小值。';
  focused.value = false;
}
</script>

<template>
  <view class="home-page" :style="{ minHeight: pageHeight + 'px' }">
    <LearningHeader @menu="menuOpen = true" @new="newChat" />
    <view class="hero">
      <text class="emblem">✳</text>
      <view class="greeting">{{ greeting }}</view>
      <text class="lede">先想一步，再懂一点。把卡住的那一步交给我。</text>
      <view class="composer">
        <view v-if="modeLabel" class="mode-row"><text>{{ modeLabel }}</text><button aria-label="切换为普通提问" @tap="scenario = 'question'"><LumaIcon name="close" :size="12" /></button></view>
        <textarea v-model="draft" class="input" :maxlength="2000" :placeholder="placeholder" placeholder-style="color:#a0ad92;font-size:14px" :focus="focused" :cursor-spacing="24" :show-confirm-bar="false" :adjust-position="true" :disabled="menuOpen" @blur="focused = false" />
        <view class="composer-bar">
          <button class="upload" @tap="upload"><LumaIcon name="plus" :size="14" /><text>上传题目</text></button>
          <button class="send" :disabled="!draft.trim() || navigating" aria-label="发送问题" @tap="send"><LumaIcon name="arrow-up" white :size="21" /></button>
        </view>
      </view>
      <view class="quick-entries">
        <button class="quick-entry" @tap="upload"><LumaIcon name="photo" :size="16" /><text>拍题求助</text></button>
        <button class="quick-entry" :class="{ selected: scenario === 'knowledge' }" @tap="chooseScenario('knowledge')"><LumaIcon name="book" :size="16" /><text>讲知识点</text></button>
        <button class="quick-entry" :class="{ selected: scenario === 'practice' }" @tap="chooseScenario('practice')"><LumaIcon name="practice" :size="16" /><text>出练习</text></button>
      </view>
      <view class="guidance"><view class="soft-dot" /><text>先给提示，陪你一步步想明白</text></view>
      <button class="sample-entry" @tap="sample"><text>试一道示例题，从这里开始</text><LumaIcon name="arrow-diagonal" :size="12" /></button>
      <view v-if="history.latest" class="continue-card">
        <view class="continue-icon"><LumaIcon name="arrow-diagonal" :size="20" /></view>
        <view class="continue-copy"><text class="continue-label">继续上次的学习</text><view class="continue-title">{{ history.latest.title }}</view></view>
        <button class="continue-action" @tap="openConversation(history.latest.id)">继续学习</button>
      </view>
      <view v-if="history.error" class="history-error"><text>学习记录暂时未能加载</text><button :disabled="history.loading" @tap="history.load()">重试</button></view>
    </view>
    <AccountPanel :open="accountOpen" @close="accountOpen = false" />
    <LearningDrawer :open="menuOpen" @account="accountOpen = true" @close="menuOpen = false" @new="newChat" @select="openConversation" />
  </view>
</template>

<style scoped lang="scss">
.home-page { box-sizing:border-box; background:#f8f7f2; color:#354a37; }
.home-page button { margin:0; padding:0; border:0; background:transparent; line-height:1.5; font-weight:400; }
.home-page button::after { border:0; }
.hero { padding:62rpx 50rpx 48rpx; text-align:center; }
.emblem { display:block; font-size:64rpx; line-height:1; color:#91a27c; margin:10rpx 0 42rpx; }
.greeting { font-family:'Songti SC','STSong',serif; font-size:54rpx; line-height:1.5; letter-spacing:2rpx; }
.lede { display:block; margin:22rpx -8rpx 58rpx; font-size:22rpx; line-height:1.95; color:#96a287; }
.composer { padding:24rpx 28rpx 22rpx; border:1rpx solid #dfe6d5; border-radius:34rpx; background:#fffefa; text-align:left; }
.input { box-sizing:border-box; width:100%; height:168rpx; font-size:30rpx; line-height:1.75; color:#405443; }
.input-placeholder { color:#a0ad92; font-size:27rpx; }
.composer-bar { display:flex; align-items:center; justify-content:space-between; margin-top:16rpx; }
.home-page .upload { display:flex; align-items:center; gap:4rpx; min-height:72rpx; font-size:23rpx; color:#788674; }
.home-page .send { display:flex; align-items:center; justify-content:center; width:72rpx; height:72rpx; border-radius:50%; background:#4f6652; flex-shrink:0; }
.home-page .send[disabled] { background:#b9c4b2; }
.quick-entries { display:flex; align-items:center; justify-content:space-around; gap:12rpx; margin-top:24rpx; }
.home-page .quick-entry { display:flex; align-items:center; justify-content:center; gap:12rpx; min-height:88rpx; font-size:22rpx; color:#78886c; white-space:nowrap; }
.home-page .quick-entry.selected { color:#405b3c; }
.mode-row { display:flex; align-items:center; gap:14rpx; margin-bottom:12rpx; font-size:21rpx; color:#7c8b6d; }
.mode-row button { display:flex; align-items:center; justify-content:center; width:44rpx; height:44rpx; }
.guidance { display:flex; justify-content:center; align-items:center; gap:9rpx; margin-top:40rpx; color:#8b9a7e; font-size:20rpx; }
.soft-dot { width:8rpx; height:8rpx; border-radius:50%; background:#91a27c; }
.home-page .sample-entry { display:flex; align-items:center; justify-content:center; gap:22rpx; min-height:72rpx; color:#a0ad92; font-size:20rpx; }
.continue-card { display:flex; align-items:center; gap:20rpx; border-top:1rpx solid #e3e9da; margin-top:38rpx; padding-top:40rpx; text-align:left; }
.continue-icon { display:flex; align-items:center; justify-content:center; width:66rpx; height:66rpx; border-radius:50%; background:#edf1e4; flex-shrink:0; }
.continue-copy { flex:1; min-width:0; }
.continue-label { display:block; color:#939e87; font-size:19rpx; }
.continue-title { display:block; width:100%; min-width:0; margin-top:9rpx; color:#44543d; font-size:24rpx; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.home-page .continue-action { color:#627b52; font-size:22rpx; padding:20rpx 0 20rpx 6rpx; flex-shrink:0; }
.history-error { display:flex; align-items:center; justify-content:center; gap:16rpx; padding-top:28rpx; font-size:22rpx; color:#9b8874; }
.home-page .history-error button { color:#617754; padding:12rpx; font-size:22rpx; }
@media(max-width:360px) { .hero { padding-left:36rpx; padding-right:36rpx; } .quick-entries { gap:8rpx; } .home-page .quick-entry { font-size:21rpx; gap:8rpx; } }
</style>
