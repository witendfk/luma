<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { SubjectEdit, SubjectView } from '@/api/conversations';
import LumaIcon from './LumaIcon.vue';

const props = defineProps<{ open: boolean; subject: SubjectView | null; saving: boolean; error: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'save', input: SubjectEdit): void }>();
const text = ref('');
const keyboard = ref(0);
const revision = ref(0);
const initial = ref('');
const snapshot = ref<SubjectView['content']>({});
const localError = ref('');
const height = uni.getSystemInfoSync().windowHeight;
const isKnowledge = computed(() => props.subject?.type === 'knowledge');
const fingerprint = () => text.value.trim();
watch(() => props.open, (open) => {
  if (!open || !props.subject) return;
  text.value = props.subject.content.text ?? '';
  revision.value = props.subject.version;
  snapshot.value = { ...props.subject.content };
  localError.value = '';
  keyboard.value = 0;
  initial.value = fingerprint();
});
function close(): void {
  if (props.saving) return;
  if (initial.value === fingerprint()) { emit('close'); return; }
  uni.showModal({ title: '放弃本次修改？', content: '还没有保存的内容会丢失，原来的学习记录不受影响。', confirmText: '放弃修改', cancelText: '继续编辑', confirmColor: '#7c876c', success: (result) => { if (result.confirm) emit('close'); } });
}
function save(): void {
  if (props.saving) return;
  localError.value = '';
  if (!text.value.trim()) { localError.value = isKnowledge.value ? '请填写要学习的内容。' : '题干不能为空。'; return; }
  if (initial.value === fingerprint()) { emit('close'); return; }
  // 题干改变后清空旧题的推断标签和小问；完整题干仍保留，由 Agent 依据新版本分析。
  emit('save', { content: { ...snapshot.value, text: text.value.trim() }, tags: [],
    subquestions: [], expectedRevision: revision.value });
}
</script>

<template>
  <view v-if="open" class="editor-layer">
    <view class="scrim" @touchmove.stop.prevent @tap="close" />
    <view class="editor" :style="{ bottom: keyboard + 'px', height: Math.max(200, Math.min(height * .62, height - keyboard - 20)) + 'px' }">
      <view class="handle" />
      <view class="heading"><view><text class="title">{{ isKnowledge ? '补充学习内容' : '修改题目' }}</text><text class="caption">{{ isKnowledge ? '用自己的话描述哪里没听懂就好' : '只需改正文字、公式或缺失的条件' }}</text></view><button class="control" aria-label="关闭题目编辑" :disabled="saving" @tap="close"><LumaIcon name="close" :size="18" /></button></view>
      <view class="writing-area">
        <textarea v-model="text" class="text-field" :maxlength="8000" :disabled="saving" :adjust-position="false" :show-confirm-bar="false" :placeholder="isKnowledge ? '比如：老师讲的配方法，我没听懂为什么要加再减' : '填写完整题干、公式和已知条件'" @keyboardheightchange="keyboard = $event.detail.height" />
      </view>
      <text v-if="localError || error" class="error" role="alert">{{ localError || error }}</text>
      <view class="footer"><text class="field-note">{{ text.length }} / 8000</text><button class="control save" :class="{ disabled: saving }" :disabled="saving" @tap="save">{{ saving ? '正在保存…' : '保存修改' }}</button></view>
    </view>
  </view>
</template>

<style scoped>
.editor-layer { position:fixed; inset:0; z-index:130; }
.scrim { position:absolute; inset:0; background:rgba(38,51,40,.26); }
.editor { position:absolute; left:0; right:0; box-sizing:border-box; display:flex; flex-direction:column; padding:38rpx 36rpx max(24rpx,env(safe-area-inset-bottom)); border-radius:36rpx 36rpx 0 0; background:#fdfcf8; color:#40543e; }
.handle { position:absolute; top:14rpx; left:calc(50% - 26rpx); width:52rpx; height:6rpx; border-radius:6rpx; background:#dde3d5; }
.editor .control { margin:0; padding:0; border:0; background:transparent; font-weight:400; line-height:1.6; }
.editor .control::after { border:0; }
.heading { display:flex; justify-content:space-between; align-items:flex-start; gap:12rpx; flex-shrink:0; padding:12rpx 0 28rpx; }
.title { display:block; font-size:32rpx; font-weight:500; letter-spacing:1rpx; }
.caption { display:block; margin-top:10rpx; color:#929e88; font-size:23rpx; line-height:1.7; }
.heading .control { display:flex; align-items:center; justify-content:center; width:64rpx; height:64rpx; flex-shrink:0; }
.writing-area { position:relative; flex:1; min-height:0; border-top:1rpx solid #e5e9df; border-bottom:1rpx solid #e5e9df; }
.text-field { position:absolute; inset:0; width:100%; height:100%; box-sizing:border-box; padding:24rpx 0; font-size:29rpx; line-height:1.9; color:#40543e; }
.field-note { font-size:21rpx; color:#9ba68e; }
.error { display:block; margin-top:16rpx; color:#a17459; font-size:23rpx; line-height:1.8; flex-shrink:0; }
.footer { display:flex; align-items:center; justify-content:space-between; gap:24rpx; padding-top:20rpx; flex-shrink:0; }
.editor .save { min-height:80rpx; padding:18rpx 32rpx; box-sizing:border-box; border-radius:40rpx; background:#4f6652; color:#fffefa; font-size:25rpx; }
.editor .control.disabled { opacity:.5; }
</style>
