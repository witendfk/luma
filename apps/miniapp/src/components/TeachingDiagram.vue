<script setup lang="ts">
import type { Diagram } from '@luma/shared';
import StudyText from '@/components/StudyText.vue';
import { previewAttachment } from '@/utils/attachments';
const props = defineProps<{ diagram: Diagram }>();
function preview() {
  if (props.diagram.figure) previewAttachment([{ id: 'teaching-figure', path: props.diagram.figure, name: props.diagram.title }], 0);
}
const formulaText = (text: string) => text.includes('$') ? text : '$$' + text + '$$';
</script>

<template>
  <view class="diagram-card">
    <text class="diagram-label">KEY IDEA</text>
    <text class="diagram-title">{{ diagram.title }}</text>
    <view v-if="diagram.figure" class="diagram-visual" @tap="preview">
      <image class="diagram-image" :src="diagram.figure" mode="widthFix" :show-menu-by-longpress="true" />
      <text class="diagram-caption">{{ diagram.graphic?.caption }} · 轻触放大</text>
    </view>
    <text v-else-if="diagram.figureError" class="diagram-caption">{{ diagram.figureError }}</text>
    <view v-for="(step, index) in diagram.steps" :key="index" class="diagram-step">
      <view class="step-marker"><text>{{ String(index + 1).padStart(2, '0') }}</text><view v-if="index < diagram.steps.length - 1" class="step-line" /></view>
      <view class="step-content">
        <text class="step-label">{{ step.label }}</text>
        <StudyText :text="step.detail" />
        <StudyText v-if="step.formula" :text="formulaText(step.formula)" />
      </view>
    </view>
    <view v-if="diagram.takeaway" class="diagram-takeaway"><text class="takeaway-mark">↳</text><StudyText :text="diagram.takeaway" /></view>
  </view>
</template>

<style scoped>
.diagram-card { margin:28rpx 0 32rpx; padding:30rpx 28rpx; border:1rpx solid #e2e8da; border-left:5rpx solid #879a76; border-radius:8rpx; background:#f1f3ea; }
.diagram-label { display:block; color:#a18b6c; font-size:17rpx; letter-spacing:2rpx; }
.diagram-title { display:block; margin:8rpx 0 22rpx; color:#465d40; font-family:'Songti SC','STSong',serif; font-size:28rpx; line-height:1.6; }
.diagram-visual { margin:0 0 26rpx; }
.diagram-image { display:block; width:100%; border-radius:8rpx; }
.diagram-caption { display:block; margin-top:12rpx; color:#819076; font-size:21rpx; line-height:1.7; }
.diagram-step { display:flex; gap:18rpx; min-height:84rpx; }
.step-marker { display:flex; width:36rpx; flex-shrink:0; flex-direction:column; align-items:center; }
.step-marker text { color:#a18b6c; font-family:Georgia,serif; font-size:20rpx; line-height:1.5; }
.step-line { flex:1; width:1rpx; min-height:28rpx; background:#cbd5c1; }
.step-content { flex:1; min-width:0; padding-bottom:20rpx; }
.step-label { display:block; margin-bottom:6rpx; color:#5f7656; font-size:23rpx; }
.step-content :deep(.study-text) { color:#687761; font-size:23rpx; line-height:1.8; }
.diagram-takeaway { display:flex; gap:12rpx; margin:4rpx 0 0 54rpx; padding-top:18rpx; border-top:1rpx solid #dce3d5; color:#536d4a; font-size:23rpx; line-height:1.8; }
.takeaway-mark { color:#9f8968; }
</style>
