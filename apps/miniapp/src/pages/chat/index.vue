<script setup lang="ts">
import { UI_MOCK } from '@/config';
import { useNotebookPreviewStore } from '@/stores/notebook-preview';
import AttachmentStrip from '@/components/AttachmentStrip.vue';
import TopicNavigator from '@/components/TopicNavigator.vue';
import ProcessSheet from '@/components/ProcessSheet.vue';
import { previewRoot, selectPreviewTopic, recognizeAttachments, setRecognition, saveTopicDraft, planPreviewTopics, rememberPreviewLocation, type PreviewRecord } from '@/mocks/workspace';
import { previewAttachment } from '@/utils/attachments';
import { sessionVersion } from '@/utils/token';
import PreviewNotice from '@/components/PreviewNotice.vue';
import { computed, nextTick, ref, watch } from 'vue';
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app';
import type { TurnRequest } from '@luma/shared';
import MessageBubble from '@/components/MessageBubble.vue';
import LearningHeader from '@/components/LearningHeader.vue';
import LearningDrawer from '@/components/LearningDrawer.vue';
import AccountPanel from '@/components/AccountPanel.vue';
import LumaIcon from '@/components/LumaIcon.vue';
import SubjectEditor from '@/components/SubjectEditor.vue';
import StudyDiscussion from '@/components/StudyDiscussion.vue';
import type { SubjectEdit } from '@/api/conversations';
import { saveCollection } from '@/api/collections';
import { useConversationStore } from '@/stores/conversation';

const store = useConversationStore();
const notebook = useNotebookPreviewStore();
onShow(() => { pageActive = true; if (UI_MOCK) { notebook.refresh(); syncPreview(); beginRecognition(); } });
const isSaved = computed(() => UI_MOCK ? notebook.records.some((row) => row.id === (activeTopic.value?.id ?? store.currentId) && row.collected) : saved.value);
const previewStudy = ref(false);
const previewMeta = ref<PreviewRecord | null>(null);
const activeTopic = computed(() => previewMeta.value?.topics?.find((topic) => topic.id === previewMeta.value?.activeTopicId));
const switchingTopic = ref(false);
let pageActive = true, recognitionTimer: ReturnType<typeof setTimeout> | undefined;
const unit = computed(() => previewMeta.value?.intent === 'knowledge' ? '部分' : '题');
const nextTopic = computed(() => { const root = previewMeta.value; const index = root?.topics?.findIndex((topic) => topic.id === root.activeTopicId) ?? -1; return root?.topics?.[index + 1]; });
const draft = ref('');
const busy = ref(false);
const menuOpen = ref(false);
const accountOpen = ref(false);
const saved = ref(false);
const saving = ref(false);
const editorOpen = ref(false);
const processOpen = ref(false);
const editorError = ref('');
const summaryOpen = ref(false);
const moreActions = ref(false);
const focused = ref(false);
const pageHeight = uni.getSystemInfoSync().windowHeight;
const keyboardHeight = ref(0);
const scrollTarget = ref('');
const isKnowledge = computed(() => store.subject?.type === 'knowledge');
const status = computed(() => !store.subject?.confirmedAt ? (isKnowledge.value ? '先核对学习范围' : '先确认题目内容') : store.waitingJob ? '学习材料正在整理' : practice.value ? '同类练习已准备好' : lesson.value ? '图文讲解已准备好' : '先提示，再逐步推导');
const ready = computed(() => Boolean(store.subject?.confirmedAt) && !store.generating && !store.confirmingSubject && !store.editingSubject);
const lesson = computed(() => store.artifacts.find((item) => item.subjectRevisionId === store.subject?.id && item.type === 'lesson' && item.publishStatus === 'published'));
const practice = computed(() => store.artifacts.find((item) => item.subjectRevisionId === store.subject?.id && item.type === 'exercise_set' && item.publishStatus === 'published'));
const recommended = computed(() => practice.value ? 'practice' : lesson.value ? 'lesson' : 'thinking');
const recommendLabel = computed(() => recommended.value === 'practice' ? '开始配套练习' : recommended.value === 'lesson' ? '阅读图文讲解' : '写下我的思路');
const subquestions = computed(() => store.subject?.subquestions ?? []);
const activePart = computed(() => subquestions.value[store.subject?.activeSubquestionIndex ?? 0]);
const confirmLabel = computed(() => store.subject?.content.intent === 'practice' ? '确认范围，开始练习' : isKnowledge.value ? '确认范围，开始讲解' : '题目无误，继续');
const lastReply = computed(() => [...store.messages].reverse().find((message) => message.role === 'assistant'));
onHide(() => { pageActive = false; clearTimeout(recognitionTimer); });
onUnload(() => { pageActive = false; clearTimeout(recognitionTimer); if (!previewStudy.value) store.stopStream(); });
onLoad(async (query) => {
  if (import.meta.env.DEV && query?.preview === 'study') { previewStudy.value = true; return; }
  try {
    if (query?.id) await openLearning(query.id, query.topic);
    else { store.reset(); if (query?.text) await store.send(decodeURIComponent(query.text), undefined, query.type === 'knowledge' ? 'knowledge' : 'question', query.intent === 'practice' ? 'practice' : query.intent === 'knowledge' ? 'knowledge' : 'question'); }
  } catch (err) { store.error = err instanceof Error ? err.message : '对话加载失败'; }
});
function scrollToEnd(): void {
  scrollTarget.value = '';
  void nextTick(() => { scrollTarget.value = 'thread-end'; });
}
watch(() => store.messages.map((message) => message.text).join('') + store.subject?.version + Boolean(store.subject?.confirmedAt), scrollToEnd);
watch(() => store.currentId, () => { editorOpen.value = false; editorError.value = ''; summaryOpen.value = false; moreActions.value = false; saved.value = false; });
watch(() => store.subject?.id, () => { summaryOpen.value = false; moreActions.value = false; processOpen.value = false; syncPreview(); });
watch(() => store.generating, (value) => { if (!value) syncPreview(); });
watch(draft, (value) => {
  if (!UI_MOCK || switchingTopic.value || !activeTopic.value) return;
  try { saveTopicDraft(activeTopic.value.id, value); } catch { uni.showToast({ title: '草稿暂未保存，请勿退出', icon: 'none' }); }
}, { flush: 'sync' });
async function onSend(): Promise<void> {
  const text = draft.value.trim();
  if (!text || store.generating || store.editingSubject || store.confirmingSubject) return;
  if (previewMeta.value?.recognition && previewMeta.value.recognition !== 'ready') return;
  focused.value = false;
  rememberChat();
  await store.send(text);
  if (!store.error) draft.value = '';
}
async function onConfirm(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  rememberChat();
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
  void openLearning(id).catch((err) => { store.error = err.message; });
}
function edit(): void {
  if (store.generating || store.confirmingSubject || store.editingSubject) return;
  focused.value = false;
  keyboardHeight.value = 0;
  editorError.value = '';
  editorOpen.value = true;
}
async function saveSubject(input: SubjectEdit): Promise<void> {
  editorError.value = '';
  try {
    if (await store.editSubject(input)) { editorOpen.value = false; uni.showToast({ title: '已保存，请重新核对', icon: 'none' }); }
  } catch (err) { editorError.value = err instanceof Error ? err.message : '保存失败，修改内容仍保留，请重试'; }
}
async function choosePart(index: number): Promise<void> {
  const subject = store.subject;
  if (!subject || (subject.activeSubquestionIndex ?? 0) === index) return;
  try { await store.editSubject({ content: subject.content, tags: subject.tags, subquestions: subquestions.value, subquestionIndex: index, expectedRevision: subject.version }); }
  catch (err) { store.error = err instanceof Error ? err.message : '小问切换失败，请重试'; }
}
function recommend(): void {
  if (recommended.value !== 'thinking') { openMaterial(recommended.value); return; }
  focused.value = false;
  void nextTick(() => { focused.value = true; });
}
function action(text: string, kind: TurnRequest['action']): void {
  if (!ready.value) return;
  if (kind === 'show_solution') {
    uni.showModal({ title: '查看完整解析', content: '建议先自己推一遍。也可以现在查看，之后再独立试一试。', confirmText: '查看解析', cancelText: '继续思考', confirmColor: '#4f6652', success: (res) => { if (res.confirm) void store.send(text, kind); } });
  } else void store.send(text, kind);
}
function rememberChat(): void { if (UI_MOCK && store.currentId) { try { rememberPreviewLocation(activeTopic.value?.id ?? store.currentId, 'chat'); } catch { /* 不阻断学习。 */ } } }
function upload(): void {
  if (!UI_MOCK) { uni.showToast({ title: '过程照片可先在前端预览中体验', icon: 'none' }); return; }
  if (!store.subject?.confirmedAt) { uni.showToast({ title: '请先核对当前题目', icon: 'none' }); return; }
  if (store.generating || switchingTopic.value) return;
  focused.value = false; processOpen.value = true;
}
function confirmProcess(text: string): void { rememberChat(); void store.send(`我已核对这些解题步骤：\n${text}\n请先引导我检查过程。`); }
async function save(): Promise<void> {
  if (!store.currentId || !store.subject?.confirmedAt || saving.value) return;
  saving.value = true;
  try { await saveCollection(activeTopic.value?.id ?? store.currentId, {}); saved.value = true; if (UI_MOCK) notebook.refresh(); uni.showToast({ title: '已保存学习记录', icon: 'none' }); }
  catch (err) { uni.showToast({ title: err instanceof Error ? err.message : '保存失败，请重试', icon: 'none' }); }
  finally { saving.value = false; }
}
function openMaterial(type: 'lesson' | 'practice'): void {
  const artifact = type === 'lesson' ? lesson.value : practice.value;
  if (artifact && UI_MOCK && (store.currentId === 'preview-quadratic' || activeTopic.value?.exampleKey)) {
    uni.navigateTo({ url: `/pages/${type === 'lesson' ? 'reader' : 'practice'}/index?preview=1&scope=${encodeURIComponent(activeTopic.value?.id ?? store.currentId!)}` }); return;
  }
  if (artifact) uni.navigateTo({ url: `/pages/${type === 'lesson' ? 'reader' : 'practice'}/index?artifactId=${artifact.id}&conversationId=${store.currentId}` });
  else action(type === 'lesson' ? '请生成图文讲解' : '请出同知识点练习', type === 'lesson' ? 'generate_lesson' : 'generate_practice');
}

function syncPreview(): void {
  if (!UI_MOCK || previewStudy.value || !store.currentId) { previewMeta.value = null; return; }
  const root = previewRoot(store.currentId);
  previewMeta.value = root?.attachments?.length ? root : null;
}
async function openLearning(id: string, topicId?: string): Promise<void> {
  clearTimeout(recognitionTimer);
  const root = UI_MOCK ? previewRoot(id) : undefined;
  switchingTopic.value = true;
  try {
    if (root?.topics?.length && (topicId || root.id !== id)) selectPreviewTopic(root.id, topicId ?? id);
    await store.open(root?.id ?? id);
    syncPreview(); draft.value = activeTopic.value?.draft ?? '';
    beginRecognition();
  } finally { switchingTopic.value = false; }
}
function beginRecognition(): void {
  clearTimeout(recognitionTimer);
  if (!pageActive || previewMeta.value?.recognition !== 'reading') return;
  const id = previewMeta.value.id, session = sessionVersion();
  recognitionTimer = setTimeout(async () => {
    if (!pageActive || session !== sessionVersion() || store.currentId !== id) return;
    try {
      recognizeAttachments(id); syncPreview(); await store.refresh();
    } catch { try { setRecognition(id, 'failed'); } catch { /* 保留原图。 */ } syncPreview(); }
  }, 900);
}
function recognitionAction(action: 'retry' | 'cancel' | 'fail'): void {
  const id = previewMeta.value?.id; if (!id) return;
  clearTimeout(recognitionTimer);
  try { setRecognition(id, action === 'retry' ? 'reading' : action === 'cancel' ? 'cancelled' : 'failed'); syncPreview(); void store.refresh(); if (action === 'retry') beginRecognition(); }
  catch { uni.showToast({ title: '状态未能保存，请重试', icon: 'none' }); }
}
async function selectTopic(id: string): Promise<void> {
  if (!previewMeta.value || switchingTopic.value || store.generating || id === activeTopic.value?.id) return;
  const rootId = previewMeta.value.id;
  switchingTopic.value = true; focused.value = false; keyboardHeight.value = 0;
  try {
    selectPreviewTopic(rootId, id); await store.open(rootId); syncPreview();
    rememberChat();
    draft.value = activeTopic.value?.draft ?? ''; scrollTarget.value = '';
    scrollToEnd();
  } catch (err) { uni.showToast({ title: err instanceof Error ? err.message : '切换失败，原进度仍保留', icon: 'none' }); }
  finally { switchingTopic.value = false; }
}
function learnAll(): void {
  if (!previewMeta.value) return;
  try { planPreviewTopics(previewMeta.value.id); syncPreview(); uni.showToast({ title: '已记下，按顺序逐项学习', icon: 'none' }); }
  catch { uni.showToast({ title: '未能保存安排，请重试', icon: 'none' }); }
}
function simulate(): void {
  uni.showActionSheet({ itemList: ['模拟识别失败'], success: () => recognitionAction('fail') });
}
</script>

<template>
  <StudyDiscussion v-if="previewStudy" />
  <view v-else class="chat-page" :style="{ height: Math.max(250, pageHeight - keyboardHeight) + 'px' }">
    <LearningHeader :title="store.title || '新建对话'" @menu="menuOpen = true" @new="newChat" />
    <PreviewNotice />
    <TopicNavigator v-if="previewMeta?.recognition === 'ready'" :root="previewMeta" :disabled="store.generating || switchingTopic || store.editingSubject || busy" @select="selectTopic" @all="learnAll" />
    <view class="task-toolbar">
      <text class="stage">{{ previewMeta && previewMeta.recognition !== 'ready' ? '先读取图片，再核对内容' : status }}</text>
      <view class="toolbar-actions">
        <button :disabled="!store.subject?.confirmedAt || saving" @tap="save"><LumaIcon name="star" :size="12" /><text>{{ isSaved ? '已保存' : isKnowledge ? '保存记录' : '保存错题' }}</text></button>
      </view>
    </view>
    <view v-if="store.archivedAt" class="archive-notice"><LumaIcon name="archive" :size="14" /><text>这段对话已归档，继续提问会恢复到最近学习。</text></view>
    <scroll-view class="thread-scroll" scroll-y :scroll-into-view="scrollTarget" :scroll-with-animation="true">
      <view class="thread">
        <view v-if="previewMeta" class="source-attachments">
          <view class="source-heading"><text>本次添加 · {{ previewMeta.attachments?.length }} 张图片</text><button v-if="previewMeta.recognition === 'ready'" @tap="previewAttachment(previewMeta.attachments ?? [], 0)">查看原图</button><button @tap="simulate">模拟异常</button></view>
          <AttachmentStrip v-if="previewMeta.recognition !== 'ready'" :images="previewMeta.attachments ?? []" readonly />
          <text v-if="previewMeta.text" class="source-prompt">{{ previewMeta.text }}</text>
          <text class="mock-extraction">示例识别结果 · 当前未读取图片真实内容</text>
        </view>
        <view v-if="previewMeta && previewMeta.recognition !== 'ready'" class="recognition-state">
          <text class="empty-symbol">✳</text>
          <text>{{ previewMeta.recognition === 'reading' ? '正在整理图片里的内容…' : previewMeta.recognition === 'failed' ? '这次没能读清图片' : '已暂停读取' }}</text>
          <text class="check-note">{{ previewMeta.recognition === 'reading' ? '多道题会分别列出，你可以选择从哪一道开始。' : '图片和你的文字都在，可以重试，或返回首页更换。' }}</text>
          <button v-if="previewMeta.recognition === 'reading'" @tap="recognitionAction('cancel')">取消本次读取</button><button v-else @tap="recognitionAction('retry')">重新读取</button>
        </view>
        <view v-if="store.subject?.confirmedAt" class="subject-summary">
          <button class="summary-toggle" :aria-label="summaryOpen ? '收起已确认内容' : '展开已确认内容'" @tap="summaryOpen = !summaryOpen"><view><text class="summary-label">{{ isKnowledge ? '学习范围已确认' : '题目已确认' }}<text v-if="activePart"> · 第 {{ (store.subject.activeSubquestionIndex ?? 0) + 1 }} 问</text></text><view v-if="!summaryOpen" class="summary-preview">{{ store.subject.content.text }}</view></view><LumaIcon :name="summaryOpen ? 'chevron-up' : 'chevron-down'" :size="14" /></button>
          <view v-if="summaryOpen" class="summary-details"><text class="subject-text" selectable>{{ store.subject.content.text }}</text><text v-if="activePart" class="check-note">当前小问：{{ activePart }}</text><button class="edit-action" :disabled="store.generating || store.confirmingSubject" @tap="edit">{{ isKnowledge ? '修改学习范围' : '修改题目' }}</button></view>
        </view>
        <view v-if="!store.messages.length && !previewMeta" class="empty"><text class="empty-symbol">✳</text><text>从你卡住的那一步，开始。</text><text class="empty-caption">写下题目或知识点，我陪你一起想。</text></view>
        <MessageBubble v-for="msg in store.messages" :key="msg.id" :role="msg.role" :text="msg.text" :incomplete="msg.incomplete" />
        <view v-if="store.subject && !store.subject.confirmedAt" class="confirmation">
          <view class="card-heading"><text>{{ isKnowledge ? '核对学习范围' : '确认题目内容' }}</text><text class="revision">{{ store.subject.version > 1 ? '已修改 · 待确认' : '待确认' }}</text></view>
          <text class="subject-text" selectable>{{ store.subject.content.text }}</text>

          <view v-if="subquestions.length" class="part-options"><text class="check-note">这次先学哪一问？</text><button v-for="(part, index) in subquestions" :key="index" :class="{ selected: (store.subject.activeSubquestionIndex ?? 0) === index }" :disabled="store.editingSubject || store.generating || busy" @tap="choosePart(index)"><text class="part-index">{{ (store.subject.activeSubquestionIndex ?? 0) === index ? '●' : '○' }}</text><text>第 {{ index + 1 }} 问 · {{ part }}</text></button></view>
          <text class="check-note">{{ store.subject.version > 1 ? '后续讲解与练习将依据修改后的内容。' : isKnowledge ? '确认要学习的内容，不清楚的范围可以先补充。' : '请检查题干、公式和已知条件。' }}</text>
          <view class="confirmation-actions"><button class="edit-action" :disabled="busy || store.generating || store.editingSubject" @tap="edit">{{ isKnowledge ? '补充内容' : '修改题目' }}</button><button class="confirm-action" :disabled="busy || store.generating || store.editingSubject" @tap="onConfirm">{{ busy ? '正在确认…' : confirmLabel }}</button></view>
        </view>
        <view v-if="ready && lastReply && !store.error" class="follow-actions">
          <button class="recommend-action" @tap="recommend"><text>{{ recommendLabel }}</text><LumaIcon name="arrow-diagonal" :size="14" /></button>
          <view class="secondary-actions"><button @tap="action('没思路，请给我一个方向提示', 'hint')">给点提示</button><button @tap="action('我想查看完整解析', 'show_solution')">看完整解析</button><button :aria-expanded="moreActions" @tap="moreActions = !moreActions">{{ moreActions ? '收起' : '更多学习方式' }}</button></view>
          <view v-if="moreActions" class="material-actions"><button v-if="recommended !== 'lesson'" :disabled="store.waitingJob && !lesson" @tap="openMaterial('lesson')">{{ lesson ? '阅读图文讲解' : '生成图文讲解' }}</button><button v-if="recommended !== 'practice'" :disabled="store.waitingJob && !practice" @tap="openMaterial('practice')">{{ practice ? '开始配套练习' : '练同类题' }}</button></view>
        </view>
        <view v-if="store.generating" class="progress-state"><view class="pulse" /><text>Luma 正在整理思路…</text></view>
        <view v-if="store.waitingJob" class="progress-state"><view class="pulse" /><text>学习材料正在生成，你可以继续提问。</text></view>
        <view v-if="store.error" class="error"><text>{{ store.error }}</text><text class="error-caption">已完成的对话仍会保留。</text></view>
        <button v-if="store.generating || store.waitingJob" class="stop" @tap="onStop">停止本次生成</button>
        <view v-if="previewMeta?.recognition === 'ready' && ready && nextTopic" class="next-topic"><text>{{ previewMeta.learnAll ? '逐项学习已安排，按自己的节奏继续' : '当前内容先学到这里，也可以继续追问' }}</text><button :disabled="store.generating" @tap="selectTopic(nextTopic.id)">看看下一{{ unit }}<LumaIcon name="arrow-diagonal" :size="13" /></button></view>
        <view id="thread-end" class="thread-end" />
      </view>
    </scroll-view>
    <view v-if="!previewMeta || previewMeta.recognition === 'ready'" class="input-dock">
      <view class="composer">
        <textarea v-model="draft" class="input" :maxlength="2000" :focus="focused" placeholder="写下你的思路，或继续追问…" placeholder-style="color:#a0ad92;font-size:14px" :show-confirm-bar="false" :adjust-position="false" :disabled="menuOpen || accountOpen || editorOpen" @blur="focused = false" @keyboardheightchange="keyboardHeight = editorOpen ? 0 : $event.detail.height" />
        <view class="composer-bar"><button class="upload" @tap="upload"><LumaIcon name="plus" :size="14" /><text>上传过程</text></button><button class="send" :disabled="!draft.trim() || store.generating || store.editingSubject || store.confirmingSubject" aria-label="发送消息" @tap="onSend"><LumaIcon name="arrow-up" white :size="21" /></button></view>
      </view>
    </view>
    <AccountPanel :open="accountOpen" @close="accountOpen = false" />
    <SubjectEditor :open="editorOpen" :subject="store.subject" :saving="store.editingSubject" :error="editorError" @close="editorOpen = false" @save="saveSubject" />
    <ProcessSheet v-if="UI_MOCK && store.currentId" :key="`${activeTopic?.id ?? store.currentId}:${store.subject?.version}`" :open="processOpen" :scope="activeTopic?.id ?? store.currentId" :revision="store.subject?.version ?? 1" @close="processOpen = false" @confirm="confirmProcess" />
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
.archive-notice { display:flex; align-items:center; gap:14rpx; padding:18rpx 32rpx; flex-shrink:0; color:#8c9279; background:#eef0e6; font-size:21rpx; line-height:1.8; }
.thread-scroll { flex:1; height:0; min-height:0; }
.thread { padding:36rpx 32rpx 0; }
.empty { display:flex; flex-direction:column; align-items:center; gap:24rpx; padding:100rpx 20rpx; font-size:28rpx; color:#6a7d5d; }
.empty-symbol { font-size:48rpx; color:#92a27c; }
.empty-caption { font-size:23rpx; color:#a1ad94; }
.confirmation { margin:0 0 36rpx 68rpx; padding:24rpx 0 8rpx; border-top:1rpx solid #dfe5d5; border-bottom:1rpx solid #e5e9df; }
.card-heading { display:flex; justify-content:space-between; gap:14rpx; font-size:25rpx; color:#54694b; }
.revision { font-size:19rpx; color:#a38b69; flex-shrink:0; padding-top:4rpx; }
.subject-text { display:block; margin:22rpx 0; white-space:pre-wrap; overflow-wrap:anywhere; font-size:27rpx; line-height:1.9; color:#3e4a37; }
.check-note { display:block; font-size:21rpx; color:#9aa58c; line-height:1.8; }
.confirmation-actions { display:flex; align-items:center; justify-content:space-between; gap:12rpx; margin-top:24rpx; }
.chat-page .edit-action { color:#80916f; font-size:22rpx; padding:16rpx 4rpx; text-align:left; }
.chat-page .confirm-action { min-height:80rpx; padding:18rpx 4rpx 18rpx 16rpx; box-sizing:border-box; color:#4f6652; font-size:24rpx; font-weight:500; }
.chat-page .confirm-action[disabled],.chat-page .edit-action[disabled] { opacity:.5; }
.subject-summary { margin-bottom:32rpx; border-bottom:1rpx solid #e3e8dc; }
.chat-page .summary-toggle { display:flex; align-items:center; justify-content:space-between; gap:20rpx; width:100%; padding:0 0 24rpx; text-align:left; }
.summary-toggle>view { flex:1; min-width:0; }
.summary-label { color:#879779; font-size:21rpx; }
.summary-preview { margin-top:10rpx; font-size:23rpx; color:#667b5a; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.summary-details { padding-bottom:16rpx; }
.summary-details .subject-text { margin-top:0; }
.part-options { margin:20rpx 0; }
.chat-page .part-options button { display:flex; align-items:flex-start; gap:12rpx; width:100%; text-align:left; padding:14rpx 0; font-size:22rpx; color:#97a18d; }
.part-options button.selected { color:#4f6652; }
.part-index { flex-shrink:0; }
.part-options button text:last-child { min-width:0; overflow-wrap:anywhere; }
.follow-actions { margin:0 0 30rpx 68rpx; }
.chat-page .recommend-action { display:flex; align-items:center; justify-content:space-between; gap:20rpx; width:100%; padding:22rpx 0; border-top:1rpx solid #e1e7d8; text-align:left; font-size:26rpx; color:#516b48; }
.secondary-actions,.material-actions { display:flex; flex-wrap:wrap; gap:8rpx 26rpx; }
.secondary-actions button,.material-actions button { min-height:72rpx; font-size:21rpx; color:#8a987e; }
.material-actions { border-top:1rpx solid #e8ecdf; }
.material-actions button { color:#718661; }
.material-actions button[disabled] { opacity:.45; }
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
.source-attachments { padding-bottom:24rpx; margin-bottom:30rpx; border-bottom:1rpx solid #e4e8dd; }
.source-heading { display:flex; align-items:center; justify-content:space-between; color:#9ba58d; font-size:20rpx; }
.source-heading button { display:flex; align-items:center; min-height:72rpx; color:#ad9b81; font-size:19rpx; }
.source-prompt { display:block; color:#6f8262; font-size:25rpx; line-height:1.8; }
.mock-extraction { display:block; color:#ad997a; font-size:19rpx; line-height:1.8; }
.recognition-state { display:flex; align-items:center; flex-direction:column; gap:24rpx; padding:50rpx 20rpx; text-align:center; color:#6a815d; font-size:28rpx; }
.recognition-state button { min-height:88rpx; color:#8b9e7c; font-size:24rpx; }
.next-topic { display:flex; justify-content:space-between; gap:16rpx; align-items:center; margin-top:36rpx; border-top:1rpx solid #e0e6d8; color:#a1aa94; font-size:19rpx; }
.next-topic button { display:flex; align-items:center; gap:10rpx; min-height:96rpx; color:#718a60; font-size:23rpx; flex-shrink:0; }
</style>
