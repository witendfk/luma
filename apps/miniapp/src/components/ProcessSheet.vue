<script setup lang="ts">
import { ref, watch } from 'vue';
import AttachmentStrip from './AttachmentStrip.vue';
import LumaIcon from './LumaIcon.vue';
import { chooseAttachments, type LocalAttachment } from '@/utils/attachments';
import { previewRecords, savePreviewProcess } from '@/mocks/workspace';
import { sessionVersion } from '@/utils/token';
const props = defineProps<{ open: boolean; scope: string; revision: number }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'confirm', text: string): void }>();
const images = ref<LocalAttachment[]>([]), text = ref('');
const choosing = ref(false), invalid = ref(false), saving = ref(false), keyboard = ref(0);
watch(() => props.open, (open) => {
  if (!open) return;
  const saved = previewRecords().find((row) => row.id === props.scope)?.processes?.[String(props.revision)];
  images.value = saved?.images ?? []; text.value = saved?.text ?? ''; invalid.value = false; keyboard.value = 0;
});
function remember(): boolean {
  try { savePreviewProcess(props.scope, images.value, text.value, false); return true; }
  catch { uni.showToast({ title: '草稿未能保存，请勿退出', icon: 'none' }); return false; }
}
function close(): void { if (!saving.value && remember()) emit('close'); }
async function choose(index?: number): Promise<void> {
  if (choosing.value) return;
  if (index === undefined && images.value.length >= 3) { uni.showToast({ title: '本次最多添加 3 张图片', icon: 'none' }); return; }
  const scope = props.scope, revision = props.revision, session = sessionVersion(); choosing.value = true;
  try {
    const selected = await chooseAttachments(index === undefined ? 3 - images.value.length : 1);
    if (!selected?.length || !props.open || props.scope !== scope || props.revision !== revision || session !== sessionVersion()) return;
    if (index === undefined) images.value.push(...selected); else images.value.splice(index, 1, selected[0]!);
    if (!text.value) {
      const key = previewRecords().find((row) => row.id === scope)?.exampleKey;
      text.value = key === 'sets' ? 'A 与 B 都有 2、3，所以交集是 {2, 3}。' : key === 'inequality' ? '−2x > −4，两边除以 −2，得到 x > 2。' : 'f(x) = x² − 2x + 3 = (x − 1)² + 2，所以最小值是 2。';
    }
    remember();
  } finally { choosing.value = false; }
}
function remove(index: number): void { images.value.splice(index, 1); remember(); }
function confirm(): void {
  if (saving.value || choosing.value || invalid.value || !images.value.length || !text.value.trim()) return;
  saving.value = true;
  try { savePreviewProcess(props.scope, images.value, text.value.trim(), true); emit('confirm', text.value.trim()); emit('close'); }
  catch { uni.showToast({ title: '未能保存，过程仍保留，请重试', icon: 'none' }); }
  finally { saving.value = false; }
}
</script>
<template>
  <view v-if="open" class="process-layer"><view class="scrim" @tap="close" /><view class="process-sheet" :style="{ bottom: keyboard + 'px' }">
    <view class="heading"><view><text class="title">带上你的解题过程</text><text class="caption">先核对步骤，再一起找到卡住的地方</text></view><button class="quiet close" aria-label="关闭过程核对" @tap="close"><LumaIcon name="close" :size="18" /></button></view>
    <scroll-view class="body" scroll-y><AttachmentStrip :images="images" @replace="choose($event)" @remove="remove" @invalid="invalid = $event" /><button class="quiet add" :disabled="choosing" @tap="choose()"><LumaIcon name="photo" :size="16" />{{ images.length ? '继续添加过程照片' : '添加过程照片' }}</button>
      <template v-if="images.length"><text class="mock-note">固定示例转写 · 未读取图片真实内容</text><textarea v-model="text" class="steps" :maxlength="2000" :show-confirm-bar="false" :adjust-position="false" @input="remember" @keyboardheightchange="keyboard = $event.detail.height" /><text class="caption">请对照原图核对文字、运算与符号，可直接修改。</text></template>
      <text v-else class="empty">拍下你已写出的步骤。即使没做完，也可以从那一步开始。</text>
    </scroll-view><view class="footer"><text class="caption">关闭后保留本机草稿</text><button class="quiet confirm" :class="{ disabled: !images.length || !text.trim() || invalid || choosing || saving }" :disabled="!images.length || !text.trim() || invalid || choosing || saving" @tap="confirm">步骤无误，继续讨论</button></view>
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
