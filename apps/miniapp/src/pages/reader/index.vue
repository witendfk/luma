<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onScopeDispose, ref } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { UI_MOCK } from '@/config';
import PreviewCollectionAction from '@/components/PreviewCollectionAction.vue';
import LumaIcon from '@/components/LumaIcon.vue';
import StudyText from '@/components/StudyText.vue';
import { studyExample } from '@/fixtures/study';
import { useStudyPreviewStore } from '@/stores/study-preview';
import { request } from '@/utils/request';
import { onSessionCleared, sessionVersion } from '@/utils/token';
interface Section { id: string; heading: string; body: string; figure?: string; caption?: string; formula?: string; note?: string }
interface Document { title: string; subject: string; intro: string; sections: Section[]; version: number }
const study = useStudyPreviewStore();
const preview = ref(false);
const tab = ref<'lesson' | 'source'>('lesson');
const loading = ref(true), error = ref(''), directoryOpen = ref(false);
const document = ref<Document | null>(null);
const scrollTarget = ref(''), activeSection = ref('');
const pageHeight = uni.getSystemInfoSync().windowHeight;
const instance = getCurrentInstance();
const availablePreview = import.meta.env.DEV;
let artifactId = '', conversationId = '', alive = true;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
const currentSection = computed(() => document.value?.sections.find((item) => item.id === activeSection.value));
const localKey = () => `luma_draft:reader:${artifactId}:${document.value?.version ?? 1}`;
function remember(): void {
  if (!activeSection.value) return;
  if (preview.value) { study.selectSection(activeSection.value); return; }
  try { uni.setStorageSync(localKey(), activeSection.value); } catch { /* 页面内保留阅读位置。 */ }
}
async function load(): Promise<void> {
  loading.value = true; error.value = '';
  const session = sessionVersion();
  try {
    if (preview.value) {
      study.restore(); document.value = { ...studyExample, version: 1 }; activeSection.value = study.sectionId;
    } else {
      if (!artifactId) throw new Error('还没有可阅读的讲解');
      // 只复用已有只读接口，本轮不修改服务端或生成链路。
      const result = await request<{ type: string; publishStatus: string; version: number; subject: { text: string }; content: { lesson?: { title: string; sections: Section[] } } }>({ method: 'GET', path: `/api/artifacts/${encodeURIComponent(artifactId)}` });
      if (!alive || session !== sessionVersion()) return;
      if (result.type !== 'lesson' || result.publishStatus !== 'published' || !result.content?.lesson?.sections?.length) throw new Error('这份讲解还没有准备好');
      document.value = { title: result.content.lesson.title, subject: result.subject.text, intro: '', sections: result.content.lesson.sections, version: result.version };
      let saved: unknown; try { saved = uni.getStorageSync(localKey()); } catch { /* 使用第一节。 */ }
      activeSection.value = document.value.sections.some((item) => item.id === saved) ? String(saved) : document.value.sections[0]!.id;
    }
  } catch (err) { if (alive && session === sessionVersion()) error.value = err instanceof Error ? err.message : '讲解暂时未能加载'; }
  finally { if (alive && session === sessionVersion()) { loading.value = false; if (document.value && activeSection.value !== document.value.sections[0]?.id) void nextTick(() => jump(activeSection.value)); } }
}
onLoad((query) => { preview.value = availablePreview && query?.preview === '1'; artifactId = query?.artifactId ?? ''; conversationId = query?.conversationId ?? ''; void load(); });
onShow(() => {
  if (preview.value) { study.endFocus(); if (document.value) { activeSection.value = study.sectionId; void nextTick(() => jump(activeSection.value)); } }
});
onHide(() => { clearTimeout(scrollTimer); remember(); });
onUnload(() => { alive = false; clearTimeout(scrollTimer); });
onScopeDispose(onSessionCleared(() => { alive = false; document.value = null; error.value = '请重新登录后继续阅读'; loading.value = false; clearTimeout(scrollTimer); }));
function jump(id: string): void {
  if (!document.value?.sections.some((item) => item.id === id)) return;
  activeSection.value = id; directoryOpen.value = false; scrollTarget.value = '';
  void nextTick(() => { if (document.value) scrollTarget.value = `section-${document.value.sections.findIndex((item) => item.id === id)}`; }); remember();
}
function trackScroll(): void {
  if (tab.value !== 'lesson') return;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    if (!alive || !document.value) return;
    const query = uni.createSelectorQuery().in(instance?.proxy);
    query.select('.reading-scroll').boundingClientRect(); query.selectAll('.lesson-section').boundingClientRect();
    query.exec((results) => {
      if (!alive || !document.value) return;
      const top = (results[0] as { top: number } | null)?.top;
      const sections = results[1] as Array<{ top: number }> | null;
      if (top === undefined || !sections?.length) return;
      let index = 0; sections.forEach((item, i) => { if (item.top <= top + 90) index = i; });
      activeSection.value = document.value.sections[index]?.id ?? activeSection.value; remember();
    });
  }, 140);
}
function switchTab(value: 'lesson' | 'source'): void { tab.value = value; scrollTarget.value = ''; void nextTick(() => { if (value === 'lesson') jump(activeSection.value); else scrollTarget.value = 'source-top'; }); }
function back(): void {
  if (getCurrentPages().length > 1) uni.navigateBack();
  else if (conversationId) uni.redirectTo({ url: `/pages/chat/index?id=${encodeURIComponent(conversationId)}` });
  else uni.switchTab({ url: '/pages/home/index' });
}
function ask(section: Section, example: boolean): void {
  if (!preview.value) { uni.showToast({ title: '段落追问可先在交互预览中体验', icon: 'none' }); return; }
  jump(section.id);
  study.ask({ kind: 'section', id: section.id, heading: section.heading, question: example ? `关于「${section.heading}」，可以换个例子解释吗？` : `我没理解「${section.heading}」这一步，请再引导我一下。` });
  uni.navigateTo({ url: '/pages/chat/index?preview=study' });
}
function practice(): void {
  if (!preview.value) { uni.showToast({ title: '作答交互可先从首页预览入口体验', icon: 'none' }); return; }
  remember(); uni.navigateTo({ url: '/pages/practice/index?preview=1' });
}
function showImage(src: string): void { uni.previewImage({ current: src, urls: [src] }); }
function previewExample(): void { preview.value = true; artifactId = ''; void load(); }
</script>

<template>
  <view class="reader-page" :style="{ height: pageHeight + 'px' }">
    <view v-if="preview" class="preview-label">交互预览 · 示例讲解与回复 · 仅保存在本机</view>
    <view class="reading-navigation"><view class="tabs"><button :class="{ active: tab === 'source' }" @tap="switchTab('source')">原题</button><button :class="{ active: tab === 'lesson' }" @tap="switchTab('lesson')">图文讲解</button><button @tap="practice">配套练习</button></view><button class="directory-button" :disabled="!document || tab !== 'lesson'" aria-label="阅读目录" @tap="directoryOpen = true"><LumaIcon name="menu" :size="18" /></button></view>
    <PreviewCollectionAction v-if="UI_MOCK && preview" />
    <view v-if="loading" class="state"><text class="state-symbol">✳</text><text>正在打开讲解…</text></view>
    <view v-else-if="error" class="state"><text class="state-symbol">✳</text><text class="state-title">{{ error }}</text><text class="state-note">你可以稍后重试，原来的对话会保留。</text><button @tap="load">重新加载</button><button v-if="availablePreview" class="quiet" @tap="previewExample">先体验阅读交互</button></view>
    <scroll-view v-else-if="document" class="reading-scroll" scroll-y :scroll-into-view="scrollTarget" :scroll-with-animation="false" @scroll="trackScroll">
      <view v-if="tab === 'source'" id="source-top" class="source-sheet"><text class="eyebrow">QUESTION</text><text class="source-title">回到题目本身</text><StudyText :text="document.subject" /><text class="source-note">考点由 Luma 分析，你只需要关注题目和自己的思路。</text><button class="text-link" @tap="switchTab('lesson')">继续阅读讲解 <LumaIcon name="arrow-diagonal" :size="13" /></button></view>
      <view v-else class="article">
        <view class="article-heading"><text class="eyebrow">LESSON NOTE</text><text class="lesson-title">{{ document.title }}</text><text v-if="document.intro" class="lesson-intro">{{ document.intro }}</text><text class="reading-meta">{{ document.sections.length }} 个小节 · 按自己的节奏理解</text></view>
        <view v-for="(section, index) in document.sections" :id="`section-${index}`" :key="section.id" class="lesson-section">
          <view class="section-heading"><text class="section-number">{{ String(index + 1).padStart(2, '0') }}</text><text>{{ section.heading }}</text></view>
          <StudyText :text="section.body" />
          <view v-if="section.figure" class="figure" @tap="showImage(section.figure)"><image :src="section.figure" mode="widthFix" /><text class="figure-caption">{{ section.caption }}<text class="image-hint">轻触查看</text></text></view>
          <scroll-view v-if="section.formula" class="formula" scroll-x><text selectable>{{ section.formula }}</text></scroll-view>
          <view v-if="section.note" class="insight"><text>{{ section.note }}</text></view>
          <view class="section-actions"><button @tap="ask(section, false)">这一步没懂</button><button @tap="ask(section, true)">换个例子</button></view>
        </view>
        <button class="next-step" @tap="practice"><view><text class="next-caption">接下来，试着自己做</text><text class="next-title">配套练习<text class="next-meta">2 题 · 同一知识点</text></text></view><LumaIcon name="arrow-diagonal" :size="20" /></button>
      </view>
    </scroll-view>
    <view v-if="document && tab === 'lesson'" class="reading-footer"><view><text class="footer-label">正在阅读</text><text class="footer-section">{{ currentSection?.heading }}</text></view><button @tap="currentSection && ask(currentSection, false)">问问这一步<LumaIcon name="arrow-diagonal" :size="13" /></button></view>
    <view v-if="directoryOpen" class="directory-layer"><view class="scrim" @tap="directoryOpen = false" /><view class="directory"><view class="directory-title"><text>阅读目录</text><button aria-label="关闭目录" @tap="directoryOpen = false"><LumaIcon name="close" :size="18" /></button></view><button v-for="(section, index) in document?.sections" :key="section.id" class="directory-item" :class="{ selected: section.id === activeSection }" @tap="jump(section.id)"><text class="section-number">{{ String(index + 1).padStart(2, '0') }}</text><text>{{ section.heading }}</text><text v-if="section.id === activeSection">·</text></button></view></view>
  </view>
</template>

<style scoped>
.reader-page { display:flex; flex-direction:column; background:#f8f7f2; color:#40543e; overflow:hidden; }
.reader-page button { margin:0; padding:0; border:0; background:transparent; line-height:1.6; font-weight:400; }
.reader-page button::after { border:0; }
.preview-label { padding:10rpx 28rpx; text-align:center; color:#9e8b70; background:#f4efe5; font-size:19rpx; flex-shrink:0; }
.reading-navigation { display:flex; align-items:center; border-bottom:1rpx solid #e4e8dc; flex-shrink:0; padding:0 24rpx; }
.tabs { display:flex; flex:1; justify-content:center; gap:48rpx; }
.reading-navigation .directory-button { display:flex; align-items:center; justify-content:center; width:80rpx; height:88rpx; flex-shrink:0; }
.directory-button[disabled] { opacity:.35; }
.tabs button { position:relative; padding:22rpx 0; font-size:25rpx; color:#94a087; min-height:84rpx; box-sizing:border-box; }
.tabs button.active { color:#425d3f; }
.tabs button.active::before { position:absolute; content:''; left:20%; right:20%; bottom:0; height:3rpx; border-radius:3rpx; background:#6f8560; }
.reading-scroll { flex:1; min-height:0; height:0; }
.article,.source-sheet { padding:44rpx 38rpx max(48rpx,env(safe-area-inset-bottom)); }
.eyebrow { display:block; color:#a18763; font-size:19rpx; letter-spacing:4rpx; }
.lesson-title,.source-title { display:block; margin:18rpx 0 20rpx; font-family:'Songti SC','STSong',serif; font-size:44rpx; line-height:1.55; letter-spacing:1rpx; color:#354a37; }
.lesson-intro { display:block; color:#829175; font-size:25rpx; line-height:1.9; }
.reading-meta { display:block; margin-top:24rpx; color:#a3ab99; font-size:20rpx; }
.lesson-section { padding-top:44rpx; }
.section-heading { display:flex; gap:20rpx; margin-bottom:22rpx; align-items:baseline; color:#445b3f; font-size:30rpx; line-height:1.7; }
.section-number { color:#a38c6c; font-family:Georgia,serif; font-size:22rpx; flex-shrink:0; }
.figure { margin:24rpx 0; }
.figure image { width:100%; display:block; border-radius:20rpx; }
.figure-caption { display:block; margin-top:14rpx; color:#94a086; font-size:20rpx; line-height:1.8; }
.image-hint { margin-left:16rpx; color:#adb4a5; }
.formula { width:100%; margin:24rpx 0; padding:26rpx 20rpx; box-sizing:border-box; background:#eff2e8; border-radius:14rpx; }
.formula text { white-space:nowrap; font-family:Georgia,serif; color:#506a49; font-size:31rpx; }
.insight { border-left:3rpx solid #a8b799; padding:12rpx 0 12rpx 24rpx; margin:24rpx 0; color:#66785b; font-size:27rpx; line-height:1.95; white-space:pre-wrap; }
.section-actions { display:flex; gap:38rpx; padding-top:4rpx; border-bottom:1rpx solid #e4e8dd; }
.section-actions button { min-height:82rpx; color:#839676; font-size:23rpx; }
.next-step { display:flex; justify-content:space-between; align-items:center; gap:20rpx; width:100%; margin-top:44rpx!important; padding:30rpx 0!important; text-align:left; border-top:1rpx solid #dfe6d7!important; }
.next-caption { display:block; color:#98a38d; font-size:21rpx; }
.next-title { display:block; margin-top:9rpx; color:#526d49; font-size:30rpx; }
.next-meta { margin-left:20rpx; color:#a1ab94; font-size:20rpx; }
.reading-footer { display:flex; justify-content:space-between; align-items:center; gap:20rpx; padding:18rpx 30rpx max(24rpx,env(safe-area-inset-bottom)); border-top:1rpx solid #e1e7d8; background:#fafbf7; flex-shrink:0; }
.reading-footer>view { min-width:0; flex:1; }
.footer-label { display:block; color:#a0aa93; font-size:18rpx; }
.footer-section { display:block; color:#788e68; font-size:23rpx; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.reading-footer button { display:flex; align-items:center; gap:12rpx; min-height:80rpx; color:#536f48; font-size:24rpx; flex-shrink:0; }
.source-title { margin-bottom:36rpx; }
.source-note { display:block; margin:40rpx 0 18rpx; font-size:23rpx; color:#9ba68d; line-height:1.8; }
.reader-page .text-link { display:flex; align-items:center; gap:16rpx; color:#6b855c; font-size:25rpx; min-height:88rpx; }
.state { display:flex; align-items:center; flex-direction:column; gap:20rpx; padding:110rpx 40rpx; text-align:center; color:#8d9b80; font-size:26rpx; }
.state-symbol { font-size:50rpx; color:#94a57f; }
.state-title { color:#677b5a; font-size:30rpx; }
.state-note { color:#a0aa94; font-size:23rpx; }
.state button { color:#667e58; min-height:88rpx; font-size:25rpx; }
.state button.quiet { color:#a0aa94; font-size:22rpx; }
.directory-layer { position:fixed; inset:0; z-index:120; }
.scrim { position:absolute; inset:0; background:rgba(38,51,40,.24); }
.directory { position:absolute; bottom:0; left:0; right:0; padding:32rpx 36rpx max(36rpx,env(safe-area-inset-bottom)); border-radius:32rpx 32rpx 0 0; background:#fdfcf8; }
.directory-title { display:flex; justify-content:space-between; align-items:center; margin-bottom:22rpx; color:#485e42; font-size:30rpx; }
.directory-title button { display:flex; align-items:center; justify-content:center; width:80rpx; height:80rpx; }
.directory-item { display:flex; align-items:center; gap:22rpx; width:100%; padding:24rpx 0!important; text-align:left; color:#97a08d; font-size:27rpx; border-top:1rpx solid #edf0e5!important; }
.directory-item.selected { color:#4f6c45; }
.directory-item text:nth-child(2) { flex:1; }
</style>
