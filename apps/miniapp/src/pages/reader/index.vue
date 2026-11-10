<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onScopeDispose, ref } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { UI_MOCK } from '@/config';
import PreviewCollectionAction from '@/components/PreviewCollectionAction.vue';
import LumaIcon from '@/components/LumaIcon.vue';
import StudyText from '@/components/StudyText.vue';
import TeachingDiagram from '@/components/TeachingDiagram.vue';
import { previewExampleKey, rememberPreviewLocation } from '@/mocks/workspace';
import { useStudyPreviewStore } from '@/stores/study-preview';
import { request } from '@/utils/request';
import { onSessionCleared, sessionVersion } from '@/utils/token';
import { getJob, retryJob } from '@/api/jobs';
import { getConversation } from '@/api/conversations';
import { getLessonPractice } from '@/api/practice';
import { readingProgress } from '@/utils/reading-progress';
import type { Diagram, JobView } from '@luma/shared';
interface Section { id: string; heading: string; body: string; diagram?: Diagram; formula?: string; note?: string }
interface Document { title: string; subject: string; intro: string; sections: Section[]; version: number }
const study = useStudyPreviewStore();
const preview = ref(false);
const tab = ref<'lesson' | 'source'>('lesson');
const loading = ref(true), error = ref(''), directoryOpen = ref(false);
const document = ref<Document | null>(null);
const job = ref<JobView | null>(null), retrying = ref(false);
const openingPractice = ref(false);
const draftOnly = computed(() => !!job.value && job.value.status !== 'succeeded');
const scrollTarget = ref(''), activeSection = ref('');
const pageHeight = uni.getSystemInfoSync().windowHeight;
const instance = getCurrentInstance();
let artifactId = '', jobId = '', conversationId = '', scope = 'preview-quadratic', alive = true, visible = true;
let jobTimer: ReturnType<typeof setTimeout> | undefined;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let position: ReturnType<typeof readingProgress> | undefined;
let subjectId = '', revisionId = '', requestedSection = '';
function receiveRevision(event: { conversationId: string; fromArtifactId: string; artifactId: string; sectionId?: string }): void {
  if (event.conversationId !== conversationId || event.fromArtifactId !== artifactId || !alive || preview.value) return;
  artifactId = event.artifactId; jobId = ''; job.value = null; position = undefined;
  requestedSection = event.sectionId ?? activeSection.value; activeSection.value = '';
  void load();
}
uni.$on('luma:reader-revision', receiveRevision);
const positionError = ref('');
async function flushPosition(): Promise<void> {
  clearTimeout(saveTimer);
  try { await position?.flush(); if (alive) positionError.value = ''; }
  catch (err) { if (alive) positionError.value = err instanceof Error ? err.message : '阅读位置暂未同步，已保留在本机'; }
}
const currentSection = computed(() => document.value?.sections.find((item) => item.id === activeSection.value));
const localKey = () => `luma_draft:reader:${artifactId}:${document.value?.version ?? 1}`;
function remember(): void {
  if (!activeSection.value) return;
  if (preview.value) { study.selectSection(activeSection.value); if (visible && UI_MOCK) { try { rememberPreviewLocation(scope, 'reader'); } catch { /* 草稿状态另行显示。 */ } } return; }
  try { uni.setStorageSync(localKey(), activeSection.value); } catch { /* 页面内保留阅读位置。 */ }
  position?.remember(activeSection.value);
  clearTimeout(saveTimer);
  if (visible) saveTimer = setTimeout(() => void flushPosition(), 500);
}
async function load(): Promise<void> {
  loading.value = true; error.value = '';
  const session = sessionVersion();
  try {
    if (preview.value) {
      study.restore(scope, previewExampleKey(scope)); document.value = { ...study.example, version: 1 }; activeSection.value = study.sectionId;
    } else {
      if (jobId && !artifactId) {
        const state = await getJob(jobId);
        if (!alive || session !== sessionVersion()) return;
        job.value = state;
        if (state.status === 'succeeded' && state.artifactId) artifactId = state.artifactId;
        else {
          if (state.draft) {
            document.value = { ...state.draft, subject: '', intro: '', version: 1 };
            if (!document.value.sections.some((s) => s.id === activeSection.value)) activeSection.value = document.value.sections[0]?.id ?? '';
          }
          scheduleJob(); return;
        }
      }
      if (!artifactId) throw new Error('还没有可阅读的讲解');
      const result = await request<{ id: string; type: string; publishStatus: string; version: number; conversationId: string; subjectId: string; subjectRevisionId: string; subjectVersion: number; subject: { text: string }; content: { lesson?: { title: string; sections: Section[] } } }>({ method: 'GET', path: `/api/artifacts/${encodeURIComponent(artifactId)}` });
      if (!alive || session !== sessionVersion()) return;
      if (result.type !== 'lesson' || result.publishStatus !== 'published' || !result.content?.lesson?.sections?.length) throw new Error('这份讲解还没有准备好');
      document.value = { title: result.content.lesson.title, subject: result.subject.text, intro: '', sections: result.content.lesson.sections, version: result.version };
      conversationId = result.conversationId; subjectId = result.subjectId; revisionId = result.subjectRevisionId;
      const detail = await getConversation(conversationId);
      if (!alive || session !== sessionVersion()) return;
      const object = detail.subjects.find((s) => s.id === subjectId);
      position = object?.revision?.id === revisionId && object.progress ? readingProgress({ conversationId, subjectId, revisionId,
        revision: result.subjectVersion, artifactId, initial: object.progress, isCurrent: () => alive && session === sessionVersion() && artifactId === result.id }) : undefined;
      let saved: unknown; try { saved = uni.getStorageSync(localKey()); } catch { /* 使用第一节。 */ }
      const serverSection = object?.progress?.currentArtifactId === artifactId ? object.progress.currentSectionId : null;
      const resume = requestedSection || serverSection || saved; requestedSection = '';
      if (!activeSection.value && document.value.sections.some((s) => s.id === resume)) activeSection.value = String(resume);
      if (!document.value.sections.some((item) => item.id === activeSection.value)) activeSection.value = document.value.sections.some((item) => item.id === saved) ? String(saved) : document.value.sections[0]!.id;
      remember();
    }
  } catch (err) { if (alive && session === sessionVersion()) error.value = err instanceof Error ? err.message : '讲解暂时未能加载'; }
  finally { if (alive && session === sessionVersion()) { loading.value = false; if (document.value && activeSection.value !== document.value.sections[0]?.id) void nextTick(() => jump(activeSection.value)); } }
}
function scheduleJob(): void {
  clearTimeout(jobTimer);
  if (visible && alive && job.value && ['queued', 'running'].includes(job.value.status)) jobTimer = setTimeout(() => void loadJob(), 2000);
}
async function loadJob(): Promise<void> {
  // Poll without replacing the scroll container or the reading position.
  const session = sessionVersion();
  try {
    const state = await getJob(jobId);
    if (!alive || !visible || session !== sessionVersion()) return;
    job.value = state; error.value = '';
    if (state.artifactId && state.status === 'succeeded') { artifactId = state.artifactId; await load(); return; }
    if (state.draft) {
      document.value = { ...state.draft, subject: '', intro: '', version: 1 };
      if (!activeSection.value) activeSection.value = state.draft.sections[0]?.id ?? '';
    }
    scheduleJob();
  } catch (err) { if (alive && session === sessionVersion()) error.value = err instanceof Error ? err.message : '任务状态暂时不可用'; }
}
async function retryLesson(): Promise<void> {
  if (retrying.value || !job.value || job.value.status !== 'failed') return;
  retrying.value = true; const session = sessionVersion();
  try {
    const state = await retryJob(jobId);
    if (!alive || session !== sessionVersion()) return;
    jobId = state.id; job.value = state; error.value = ''; scheduleJob();
  } catch (err) { if (alive && session === sessionVersion()) error.value = err instanceof Error ? err.message : '重试未能开始'; }
  finally { retrying.value = false; }
}
onLoad((query) => { scope = query?.scope ?? ''; artifactId = query?.artifactId ?? ''; jobId = query?.jobId ?? ''; conversationId = query?.conversationId ?? ''; requestedSection = query?.sectionId ?? ''; void load(); });
onShow(() => {
  visible = true;
  if (jobId && job.value && ['queued', 'running'].includes(job.value.status)) void loadJob();
  if (preview.value) { study.restore(scope, previewExampleKey(scope)); study.endFocus(); if (document.value) { activeSection.value = study.sectionId; void nextTick(() => jump(activeSection.value)); } }
});
onHide(() => { visible = false; clearTimeout(scrollTimer); clearTimeout(jobTimer); remember(); void flushPosition(); });
onUnload(() => { alive = false; uni.$off('luma:reader-revision', receiveRevision); clearTimeout(scrollTimer); clearTimeout(jobTimer); clearTimeout(saveTimer); });
onScopeDispose(onSessionCleared(() => { alive = false; document.value = null; job.value = null; error.value = '请重新登录后继续阅读'; loading.value = false; clearTimeout(scrollTimer); clearTimeout(jobTimer); }));
function jump(id: string): void {
  if (!document.value?.sections.some((item) => item.id === id)) return;
  activeSection.value = id; directoryOpen.value = false; scrollTarget.value = '';
  void nextTick(() => { if (document.value) scrollTarget.value = `section-${document.value.sections.findIndex((item) => item.id === id)}`; }); remember();
}
function trackScroll(event: { detail: { scrollTop: number; scrollHeight: number } }): void {
  if (tab.value !== 'lesson') return;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    if (!alive || !document.value) return;
    const query = uni.createSelectorQuery().in(instance?.proxy);
    query.select('.reading-scroll').boundingClientRect(); query.selectAll('.lesson-section').boundingClientRect();
    query.exec((results) => {
      if (!alive || !document.value) return;
      const viewport = results[0] as { top: number; height: number } | null;
      const top = viewport?.top;
      const sections = results[1] as Array<{ top: number }> | null;
      if (top === undefined || !sections?.length) return;
      let index = 0; sections.forEach((item, i) => { if (item.top <= top + 90) index = i; });
      if (viewport && event.detail.scrollTop > 0 && event.detail.scrollTop + viewport.height >= event.detail.scrollHeight - 12) index = sections.length - 1;
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
  if (!preview.value) {
    if (!artifactId || draftOnly.value) return;
    jump(section.id);
    const question = example ? `请给「${section.heading}」换个例子并更新这一节，保留其他小节。` : `我没理解「${section.heading}」这一步，请再引导我一下。`;
    uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(conversationId)}&topic=${encodeURIComponent(subjectId)}&artifactId=${encodeURIComponent(artifactId)}&artifactVersion=${document.value!.version}&sectionId=${encodeURIComponent(section.id)}&question=${encodeURIComponent(question)}${example ? '&action=generate_lesson' : ''}` }); return;
  }
  jump(section.id);
  study.ask({ kind: 'section', id: section.id, heading: section.heading, question: example ? `关于「${section.heading}」，可以换个例子解释吗？` : `我没理解「${section.heading}」这一步，请再引导我一下。` });
  uni.navigateTo({ url: '/pages/chat/index?preview=study' });
}
async function practice(): Promise<void> {
  if (!preview.value) {
    if (draftOnly.value || openingPractice.value || !document.value || !artifactId) return;
    openingPractice.value = true;
    const session = sessionVersion(), sourceId = artifactId, version = document.value.version;
    try {
      const existing = await getLessonPractice(sourceId, version);
      if (!alive || !visible || session !== sessionVersion() || sourceId !== artifactId) return;
      await flushPosition();
      const base = `/pages/chat/index?id=${encodeURIComponent(conversationId)}&topic=${encodeURIComponent(subjectId)}`;
      const url = existing.status === 'succeeded' && existing.artifactId
        ? `/pages/practice/index?artifactId=${encodeURIComponent(existing.artifactId)}`
        : existing.status !== 'none' ? `${base}&materialJobId=${encodeURIComponent(existing.jobId)}`
        : `${base}&artifactId=${encodeURIComponent(sourceId)}&artifactVersion=${version}&question=${encodeURIComponent('请根据这份讲解生成两道同知识点练习')}&action=generate_practice&practiceMode=ensure`;
      uni.navigateTo({ url, fail: () => uni.showToast({ title: '页面未能打开，请重试', icon: 'none' }) });
    } catch (err) { if (alive && session === sessionVersion()) uni.showToast({ title: err instanceof Error ? err.message : '练习状态暂时不可用，请重试', icon: 'none' }); }
    finally { openingPractice.value = false; }
    return;
  }
  remember(); uni.navigateTo({ url: `/pages/practice/index?preview=1&scope=${encodeURIComponent(scope)}` });
}
</script>

<template>
  <view class="reader-page" :style="{ height: pageHeight + 'px' }">
    <view v-if="preview" class="preview-label">交互预览 · 示例讲解与回复 · 仅保存在本机</view>
    <view class="reading-navigation"><view class="tabs"><button :disabled="draftOnly" :class="{ active: tab === 'source' }" @tap="switchTab('source')">原题</button><button :class="{ active: tab === 'lesson' }" @tap="switchTab('lesson')">图文讲解</button><button :disabled="draftOnly" @tap="practice">配套练习</button></view><button class="directory-button" :disabled="!document || tab !== 'lesson'" aria-label="阅读目录" @tap="directoryOpen = true"><LumaIcon name="menu" :size="18" /></button></view>
    <view v-if="draftOnly" class="generation-note"><text>{{ job?.status === 'failed' ? job.error?.message : ['cancelled', 'superseded'].includes(job?.status ?? '') ? '生成已结束，请返回对话重新整理' : job?.step || '正在整理讲解正文' }}</text><text v-if="document" class="generation-caption">正文草稿 · 尚未完成图文复核</text><button v-if="job?.status === 'failed'" :disabled="retrying" @tap="retryLesson">{{ retrying ? '正在重试…' : '重试生成' }}</button></view>
    <PreviewCollectionAction v-if="UI_MOCK && preview" />
    <view v-if="positionError" class="generation-note"><text>{{ positionError }}</text><button @tap="flushPosition">重试同步</button></view>
    <view v-if="loading" class="state"><text class="state-symbol">✳</text><text>正在打开讲解…</text></view>
    <view v-else-if="error" class="state"><text class="state-symbol">✳</text><text class="state-title">{{ error }}</text><text class="state-note">你可以稍后重试，原来的对话会保留。</text><button @tap="load">重新加载</button></view>
    <view v-else-if="!document && job" class="state"><text class="state-symbol">✳</text><text>{{ ['queued', 'running'].includes(job.status) ? '正文准备好后，会出现在这里。' : '你可以返回对话，继续学习。' }}</text></view>
    <scroll-view v-else-if="document" class="reading-scroll" scroll-y :scroll-into-view="scrollTarget" :scroll-with-animation="false" @scroll="trackScroll">
      <view v-if="tab === 'source'" id="source-top" class="source-sheet"><text class="eyebrow">QUESTION</text><text class="source-title">回到题目本身</text><StudyText :text="document.subject" /><text class="source-note">考点由 Luma 分析，你只需要关注题目和自己的思路。</text><button class="text-link" @tap="switchTab('lesson')">继续阅读讲解 <LumaIcon name="arrow-diagonal" :size="13" /></button></view>
      <view v-else class="article">
        <view class="article-heading"><text class="eyebrow">LESSON NOTE</text><text class="lesson-title">{{ document.title }}</text><text v-if="document.intro" class="lesson-intro">{{ document.intro }}</text><text class="reading-meta">{{ document.sections.length }} 个小节 · 按自己的节奏理解</text></view>
        <view v-for="(section, index) in document.sections" :id="`section-${index}`" :key="section.id" class="lesson-section">
          <view class="section-heading"><text class="section-number">{{ String(index + 1).padStart(2, '0') }}</text><text>{{ section.heading }}</text></view>
          <StudyText :text="section.body" />
          <TeachingDiagram v-if="section.diagram" :diagram="section.diagram" />
          <scroll-view v-if="section.formula" class="formula" scroll-x><text selectable>{{ section.formula }}</text></scroll-view>
          <view v-if="section.note" class="insight"><text>{{ section.note }}</text></view>
          <view v-if="!draftOnly" class="section-actions"><button @tap="ask(section, false)">这一步没懂</button><button @tap="ask(section, true)">换个例子</button></view>
        </view>
        <button v-if="!draftOnly" class="next-step" @tap="practice"><view><text class="next-caption">接下来，试着自己做</text><text class="next-title">配套练习<text class="next-meta">同一知识点</text></text></view><LumaIcon name="arrow-diagonal" :size="20" /></button>
      </view>
    </scroll-view>
    <view v-if="document && tab === 'lesson'" class="reading-footer"><view><text class="footer-label">正在阅读{{ draftOnly ? '草稿' : '' }}</text><text class="footer-section">{{ currentSection?.heading }}</text></view><button v-if="!draftOnly" @tap="currentSection && ask(currentSection, false)">问问这一步<LumaIcon name="arrow-diagonal" :size="13" /></button></view>
    <view v-if="directoryOpen" class="directory-layer"><view class="scrim" @tap="directoryOpen = false" /><view class="directory"><view class="directory-title"><text>阅读目录</text><button aria-label="关闭目录" @tap="directoryOpen = false"><LumaIcon name="close" :size="18" /></button></view><button v-for="(section, index) in document?.sections" :key="section.id" class="directory-item" :class="{ selected: section.id === activeSection }" @tap="jump(section.id)"><text class="section-number">{{ String(index + 1).padStart(2, '0') }}</text><text>{{ section.heading }}</text><text v-if="section.id === activeSection">·</text></button></view></view>
  </view>
</template>

<style scoped>
.reader-page { display:flex; flex-direction:column; background:#f8f7f2; color:#40543e; overflow:hidden; }
.reader-page button { margin:0; padding:0; border:0; background:transparent; line-height:1.6; font-weight:400; }
.reader-page button::after { border:0; }
.generation-note { padding:22rpx 36rpx; background:#f2f0e6; color:#847b62; font-size:23rpx; line-height:1.8; flex-shrink:0; }
.generation-caption { display:block; font-size:20rpx; color:#a49b84; }
.generation-note button { display:inline-block; color:#526d49; font-size:24rpx; padding:12rpx 0; }
.tabs button[disabled] { opacity:.4; }
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
