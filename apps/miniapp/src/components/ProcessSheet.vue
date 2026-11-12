<script setup lang="ts">
import { ref, watch, onScopeDispose } from 'vue';
import AttachmentStrip from './AttachmentStrip.vue';
import LumaIcon from './LumaIcon.vue';
import { chooseAttachments, type LocalAttachment } from '@/utils/attachments';
import { uploadAttachments, startRecognition, getRecognition, actOnRecognition, confirmTranscript } from '@/api/uploads';
import { sessionVersion } from '@/utils/token';
import type { RecognitionView } from '@luma/shared';
const props = defineProps<{ open: boolean; scope: string; revision: number; conversationId: string; subjectRevisionId: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'confirm', text: string): void }>();
const images = ref<LocalAttachment[]>([]), text = ref(''), error = ref(''), status = ref('');
const job = ref<RecognitionView | null>(null), loadedJob = ref('');
const choosing = ref(false), invalid = ref(false), saving = ref(false), reading = ref(false), keyboard = ref(0);
let timer: ReturnType<typeof setTimeout> | undefined;
const key = () => `luma_draft:process:${props.scope}:${props.revision}`;
function remember(): boolean {
  try { uni.setStorageSync(key(), { images: images.value, text: text.value, job: job.value, loadedJob: loadedJob.value }); return true; }
  catch { error.value = '草稿暂未保存，请勿退出'; return false; }
}
function poll(): void {
  clearTimeout(timer);
  if (!props.open || !job.value || !['queued', 'running'].includes(job.value.status)) return;
  const scope = props.scope, revision = props.revision, session = sessionVersion(), id = job.value.id;
  timer = setTimeout(async () => {
    try {
      const result = await getRecognition(props.conversationId, id);
      if (!props.open || scope !== props.scope || revision !== props.revision || session !== sessionVersion() || job.value?.id !== id) return;
      job.value = result; error.value = '';
      if (result.status === 'succeeded' && loadedJob.value !== id) { text.value = (result.steps ?? []).join('\n'); loadedJob.value = id; }
      remember(); poll();
    } catch (failure) { if (scope === props.scope && session === sessionVersion()) error.value = failure instanceof Error ? failure.message : '连接中断，请重新连接'; }
  }, 1500);
}
watch(() => props.open, (open) => {
  clearTimeout(timer);
  if (!open) return;
  const saved = uni.getStorageSync(key()) as { images?: LocalAttachment[]; text?: string; job?: RecognitionView; loadedJob?: string } | undefined;
  images.value = saved?.images ?? []; text.value = saved?.text ?? ''; job.value = saved?.job ?? null; loadedJob.value = saved?.loadedJob ?? '';
  invalid.value = false; keyboard.value = 0; error.value = ''; poll();
});
onScopeDispose(() => clearTimeout(timer));
function close(): void { if (!saving.value && !reading.value && remember()) emit('close'); }
async function choose(index?: number): Promise<void> {
  if (choosing.value || reading.value || ['queued', 'running'].includes(job.value?.status ?? '')) return;
  if (index === undefined && images.value.length >= 3) { error.value = '本次最多添加 3 张图片'; return; }
  const scope = props.scope, revision = props.revision, session = sessionVersion(); choosing.value = true;
  try {
    const selected = await chooseAttachments(index === undefined ? 3 - images.value.length : 1);
    if (!selected?.length || !props.open || scope !== props.scope || revision !== props.revision || session !== sessionVersion()) return;
    if (index === undefined) images.value.push(...selected); else images.value.splice(index, 1, selected[0]!);
    job.value = null; loadedJob.value = ''; text.value = ''; error.value = ''; remember();
  } finally { choosing.value = false; }
}
function remove(index: number): void {
  if (reading.value || ['queued', 'running'].includes(job.value?.status ?? '')) return;
  images.value.splice(index, 1); job.value = null; loadedJob.value = ''; text.value = ''; remember();
}
async function read(retry = false): Promise<void> {
  if (reading.value || choosing.value || invalid.value || !images.value.length) return;
  const scope = props.scope, revision = props.revision, session = sessionVersion(); reading.value = true; error.value = '';
  const current = () => props.scope === scope && props.revision === revision && session === sessionVersion();
  try {
    status.value = '正在上传过程照片…';
    if (retry && job.value) job.value = await actOnRecognition(props.conversationId, job.value.id, 'retry');
    else {
      const ids = await uploadAttachments(images.value, 'process_photo', { conversationId: props.conversationId, subjectRevisionId: props.subjectRevisionId });
      if (!current()) return;
      const result = await startRecognition(props.conversationId, { requestId: `process_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, attachmentIds: ids,
        subjectRevisionId: props.subjectRevisionId, intent: 'question', text: '' });
      if (!current()) return;
      job.value = result;
    }
    if (!current()) return;
    remember(); poll();
  } catch (failure) { if (current()) error.value = failure instanceof Error ? failure.message : '读取失败，请重试'; }
  finally { if (current()) { reading.value = false; status.value = ''; } }
}
async function cancel(): Promise<void> {
  if (!job.value || reading.value) return;
  const id = job.value.id, scope = props.scope, revision = props.revision, session = sessionVersion();
  try {
    const result = await actOnRecognition(props.conversationId, id, 'cancel');
    if (scope !== props.scope || revision !== props.revision || session !== sessionVersion()) return;
    job.value = result; clearTimeout(timer); remember();
  } catch (failure) { if (scope === props.scope && session === sessionVersion()) error.value = failure instanceof Error ? failure.message : '取消失败，请重试'; }
}
async function confirm(): Promise<void> {
  if (saving.value || choosing.value || invalid.value || !text.value.trim() || job.value?.status !== 'succeeded' || !job.value.transcriptId) return;
  const scope = props.scope, revision = props.revision, session = sessionVersion(); saving.value = true;
  try {
    const steps = text.value.split('\n').map((line) => line.trim()).filter(Boolean);
    await confirmTranscript(props.conversationId, job.value.transcriptId, steps);
    if (!props.open || scope !== props.scope || revision !== props.revision || session !== sessionVersion()) return;
    remember(); emit('confirm', steps.join('\n')); emit('close');
  } catch (failure) { if (scope === props.scope && session === sessionVersion()) error.value = failure instanceof Error ? failure.message : '确认失败，步骤仍保留'; }
  finally { if (scope === props.scope && session === sessionVersion()) saving.value = false; }
}
</script>
<template>
  <view v-if="open" class="process-layer"><view class="scrim" @tap="close" /><view class="process-sheet" :style="{ bottom: keyboard + 'px' }">
    <view class="heading"><view><text class="title">带上你的解题过程</text><text class="caption">先核对步骤，再一起找到卡住的地方</text></view><button class="quiet close" :disabled="reading || saving" aria-label="关闭过程核对" @tap="close"><LumaIcon name="close" :size="18" /></button></view>
    <scroll-view class="body" scroll-y>
      <AttachmentStrip :images="images" :readonly="reading || saving || ['queued', 'running'].includes(job?.status ?? '')" @replace="choose($event)" @remove="remove" @invalid="invalid = $event" />
      <button class="quiet add" :disabled="choosing || reading || ['queued', 'running'].includes(job?.status ?? '')" @tap="choose()"><LumaIcon name="photo" :size="16" />{{ images.length ? '继续添加过程照片' : '添加过程照片' }}</button>
      <text v-if="reading" class="caption">{{ status }}</text>
      <view v-else-if="job && ['queued', 'running'].includes(job.status)"><text class="caption">正在读取你的解题步骤…</text><button class="quiet add" @tap="cancel">取消本次读取</button><button v-if="error" class="quiet add" @tap="error = ''; poll()">重新连接</button></view>
      <button v-else-if="images.length && !job" class="quiet add" :disabled="invalid" @tap="read()">读取解题步骤</button>
      <button v-else-if="job && ['failed', 'cancelled'].includes(job.status)" class="quiet add" @tap="read(true)">重新读取步骤</button>
      <text v-if="error || job?.error" class="mock-note">{{ error || job?.error?.message }}</text>
      <template v-if="job?.status === 'succeeded'"><text v-for="(item, index) in job.uncertainties ?? []" :key="index" class="mock-note">待核对：{{ item }}</text><textarea v-model="text" class="steps" :maxlength="8000" :show-confirm-bar="false" :adjust-position="false" @input="remember" @keyboardheightchange="keyboard = $event.detail.height" /><text class="caption">请对照原图核对文字、运算与符号，可直接修改。</text></template>
      <text v-if="!images.length" class="empty">拍下你已写出的步骤。即使没做完，也可以从那一步开始。</text>
    </scroll-view><view class="footer"><text class="caption">核对前不会据此纠错</text><button class="quiet confirm" :class="{ disabled: !text.trim() || job?.status !== 'succeeded' || invalid || choosing || saving }" :disabled="!text.trim() || job?.status !== 'succeeded' || invalid || choosing || saving" @tap="confirm">{{ saving ? '正在确认…' : '步骤无误，继续讨论' }}</button></view>
  </view></view>
</template>
<style scoped>
.process-layer { position:fixed; inset:0; z-index:140; }
.scrim { position:absolute; inset:0; background:rgba(38,51,40,.24); }
.process-sheet { position:absolute; left:0; right:0; display:flex; flex-direction:column; max-height:78vh; padding:30rpx 36rpx max(28rpx,env(safe-area-inset-bottom)); border-radius:30rpx 30rpx 0 0; background:#fbfaf5; }
.quiet { display:flex; align-items:center; margin:0; padding:0; background:transparent; border:0; border-radius:0; line-height:1.7; font-size:24rpx; font-weight:400; color:#6b805e; }
.quiet::after { border:0; }
.heading,.footer { display:flex; align-items:center; justify-content:space-between; gap:20rpx; flex-shrink:0; }
.heading { margin-bottom:26rpx; }
.title { display:block; color:#435c3c; font-family:'Songti SC','STSong',serif; font-size:34rpx; }
.caption { display:block; color:#99a28e; font-size:21rpx; line-height:1.8; }
.close { justify-content:center; width:80rpx; height:80rpx; }
.body { min-height:0; max-height:52vh; }
.add { gap:12rpx; min-height:88rpx; }
.mock-note { display:block; color:#a28b6a; font-size:20rpx; margin:12rpx 0; }
.steps { box-sizing:border-box; width:100%; height:220rpx; padding:22rpx; background:#fffefa; border:1rpx solid #e0e6d7; border-radius:16rpx; color:#40543e; font-size:27rpx; line-height:1.9; margin-bottom:18rpx; }
.empty { display:block; padding:28rpx 0 48rpx; font-size:25rpx; color:#96a18b; line-height:1.9; }
.footer { border-top:1rpx solid #e3e8da; margin-top:24rpx; padding-top:18rpx; }
.confirm { min-height:88rpx; color:#4f6c42; flex-shrink:0; }
.confirm.disabled { opacity:.4; }
</style>
