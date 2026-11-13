<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import type { RecognitionView } from '@luma/shared';
import { actOnRecognition, getRecognition, previewRemoteAttachments, startRecognition } from '@/api/uploads';
import { sessionVersion } from '@/utils/token';
import StudyText from './StudyText.vue';
import LumaIcon from './LumaIcon.vue';
const props = defineProps<{ open: boolean; conversationId: string; subjectRevisionId: string; attemptId: string; exerciseId: string; photoIds: string[]; existingText: string; applying: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'apply', text: string, mode: 'append' | 'replace'): void }>();
const job = ref<RecognitionView | null>(null), text = ref(''), loadedJob = ref(''), error = ref('');
const pending = ref(false), editing = ref(false), mode = ref<'append' | 'replace'>('append'), keyboard = ref(0);
const scope = computed(() => JSON.stringify([props.conversationId, props.subjectRevisionId, props.attemptId, props.exerciseId, props.photoIds]));
const key = () => `luma_draft:answer-transcript:${props.attemptId}:${props.exerciseId}`;
const running = computed(() => job.value?.status === 'queued' || job.value?.status === 'running');
let timer: ReturnType<typeof setTimeout> | undefined, generation = 0;
function remember(): boolean {
  try { uni.setStorageSync(key(), { scope: scope.value, job: job.value, text: text.value, loadedJob: loadedJob.value }); return true; }
  catch { error.value = '转写草稿暂未保存，请勿退出'; return false; }
}
function applyResult(result: RecognitionView): void {
  job.value = result;
  if (result.status === 'succeeded' && loadedJob.value !== result.id) {
    text.value = (result.steps ?? []).join('\n'); loadedJob.value = result.id;
  }
  remember();
}
async function refresh(): Promise<void> {
  if (!job.value || pending.value) return;
  const version = generation, session = sessionVersion(), id = job.value.id;
  pending.value = true;
  try {
    const result = await getRecognition(props.conversationId, id);
    if (!props.open || version !== generation || session !== sessionVersion()) return;
    error.value = ''; applyResult(result); poll();
  } catch (failure) { if (version === generation && session === sessionVersion()) error.value = failure instanceof Error ? failure.message : '连接中断，请重新连接'; }
  finally { if (version === generation) pending.value = false; }
}
function poll(): void {
  clearTimeout(timer);
  if (props.open && running.value) timer = setTimeout(() => void refresh(), 1500);
}
watch(() => [props.open, scope.value] as const, ([open]) => {
  generation++; clearTimeout(timer); pending.value = false;
  if (!open) return;
  job.value = null; loadedJob.value = ''; text.value = ''; error.value = ''; editing.value = false; mode.value = 'append'; keyboard.value = 0;
  try {
    const saved = uni.getStorageSync(key());
    if (saved?.scope === scope.value) { job.value = saved.job; text.value = saved.text ?? ''; loadedJob.value = saved.loadedJob ?? ''; }
  } catch { error.value = '转写草稿读取失败，原作答与照片仍保留'; }
  if (job.value) void refresh(); else void read();
}, { immediate: true });
onScopeDispose(() => { generation++; clearTimeout(timer); });
async function read(retry = false): Promise<void> {
  if (pending.value || running.value || !props.photoIds.length) return;
  const version = generation, session = sessionVersion(); pending.value = true; error.value = '';
  try {
    const result = retry && job.value ? await actOnRecognition(props.conversationId, job.value.id, 'retry') : await startRecognition(props.conversationId, {
      requestId: `answer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, attachmentIds: [...props.photoIds],
      subjectRevisionId: props.subjectRevisionId, attemptId: props.attemptId, exerciseId: props.exerciseId, intent: 'practice', text: '',
    });
    if (!props.open || version !== generation || session !== sessionVersion()) return;
    applyResult(result); poll();
  } catch (failure) { if (version === generation && session === sessionVersion()) error.value = failure instanceof Error ? failure.message : '提取失败，请重试'; }
  finally { if (version === generation) pending.value = false; }
}
async function cancel(): Promise<void> {
  if (!job.value || pending.value) return;
  const version = generation, session = sessionVersion(); pending.value = true;
  try {
    const result = await actOnRecognition(props.conversationId, job.value.id, 'cancel');
    if (version === generation && session === sessionVersion()) { clearTimeout(timer); applyResult(result); }
  } catch (failure) { if (version === generation) error.value = failure instanceof Error ? failure.message : '取消失败'; }
  finally { if (version === generation) pending.value = false; }
}
function close(): void { if (!props.applying && remember()) emit('close'); }
function apply(): void {
  if (props.applying || pending.value || job.value?.status !== 'succeeded' || !text.value.trim()) return;
  const merged = mode.value === 'append' && props.existingText.trim() ? `${props.existingText.trimEnd()}\n${text.value.trim()}` : text.value.trim();
  if (merged.length > 8000) { error.value = '合并后超过8000字，请精简转写或选择替换原内容'; return; }
  if (remember()) emit('apply', text.value.trim(), mode.value);
}
</script>
<template>
  <view v-if="open" class="layer"><view class="scrim" @tap="close" /><view class="sheet" :style="{ bottom: keyboard + 'px' }">
    <view class="heading"><view><text class="title">核对你的作答</text><text class="note">只转写原稿，不替你订正解法</text></view><button class="quiet" :disabled="applying" aria-label="关闭作答转写" @tap="close"><LumaIcon name="close" :size="18" /></button></view>
    <scroll-view class="body" scroll-y>
      <button class="quiet link" @tap="previewRemoteAttachments(photoIds)"><LumaIcon name="photo" :size="15" />对照原图 · {{ photoIds.length }} 张</button>
      <template v-if="running"><text class="note">正在提取作答文字…可以先关闭，稍后回来核对。</text><button class="quiet link" :disabled="pending" @tap="cancel">取消提取</button></template>
      <button v-else-if="!job" class="link" :disabled="pending" @tap="read()">{{ pending ? '正在开始…' : '提取作答文字' }}</button>
      <button v-else-if="job?.status === 'failed' || job?.status === 'cancelled'" class="link" :disabled="pending" @tap="read(true)">重新提取</button>
      <text v-else-if="job?.status === 'superseded'" class="warning">作答状态或照片已变化，请返回当前题目重新核对。</text>
      <text v-if="error || job?.error" class="warning">{{ error || job?.error?.message }}</text>
      <button v-if="error && job" class="link" :disabled="pending" @tap="refresh">重新连接</button>
      <template v-if="job?.status === 'succeeded'">
        <text v-for="(item, i) in job.uncertainties ?? []" :key="i" class="warning">待核对：{{ item }}</text>
        <textarea v-if="editing" v-model="text" class="editor" :maxlength="8000" :disabled="applying" :show-confirm-bar="false" :adjust-position="false" @input="remember" @keyboardheightchange="keyboard = $event.detail.height" />
        <view v-else class="preview"><StudyText :text="text" /></view>
        <button class="quiet link" :disabled="applying" @tap="editing = !editing; keyboard = 0">{{ editing ? '查看排版' : '修改转写' }}</button>
        <text class="note">请核对公式、运算和符号；无法辨认的部分可直接补写。</text>
        <view v-if="existingText.trim()" class="merge"><text class="note">作答框已有内容，填入时：</text><view class="options"><button class="quiet" :class="{ selected: mode === 'append' }" @tap="mode = 'append'">{{ mode === 'append' ? '●' : '○' }} 追加到末尾</button><button class="quiet" :class="{ selected: mode === 'replace' }" @tap="mode = 'replace'">{{ mode === 'replace' ? '●' : '○' }} 替换原内容</button></view></view>
      </template>
    </scroll-view>
    <view class="footer"><text class="note">原图保留，不会自动提交</text><button class="quiet" :disabled="applying || pending || job?.status !== 'succeeded' || !text.trim()" @tap="apply">{{ applying ? '正在保存…' : '填入作答框' }}</button></view>
  </view></view>
</template>
<style scoped>
.layer { position:fixed; inset:0; z-index:140; }
.scrim { position:absolute; inset:0; background:rgba(38,51,40,.24); }
.sheet { position:absolute; left:0; right:0; display:flex; flex-direction:column; max-height:80vh; padding:30rpx 36rpx max(28rpx,env(safe-area-inset-bottom)); border-radius:30rpx 30rpx 0 0; background:#fbfaf5; }
.heading,.footer { display:flex; align-items:center; justify-content:space-between; gap:20rpx; flex-shrink:0; }
.heading { margin-bottom:18rpx; }
.title { display:block; color:#435c3c; font-family:'Songti SC','STSong',serif; font-size:34rpx; }
.note { display:block; color:#99a28e; font-size:21rpx; line-height:1.8; }
.body { min-height:0; max-height:52vh; }
.quiet { display:flex; align-items:center; min-height:80rpx; padding:0; margin:0; border:0; border-radius:0; background:transparent; font-size:24rpx; font-weight:400; color:#6b805e; line-height:1.7; }
.quiet::after { border:0; }
.heading .quiet { width:70rpx; justify-content:center; }
.link { gap:12rpx; }
.warning { display:block; color:#a28b6a; font-size:21rpx; line-height:1.8; margin:12rpx 0; }
.editor,.preview { width:100%; box-sizing:border-box; margin:12rpx 0; padding:22rpx; background:#fffefa; border:1rpx solid #e0e6d7; border-radius:16rpx; color:#40543e; font-size:27rpx; line-height:1.9; }
.editor { height:260rpx; }
.merge { margin:20rpx 0; border-top:1rpx solid #e3e8da; padding-top:18rpx; }
.options { display:flex; gap:32rpx; }
.options .quiet { color:#99a28e; font-size:22rpx; }
.options .selected { color:#4f6c42; }
.footer { margin-top:24rpx; border-top:1rpx solid #e3e8da; padding-top:18rpx; }
.footer .quiet { flex-shrink:0; color:#4f6c42; }

</style>
