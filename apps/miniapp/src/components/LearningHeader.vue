<script setup lang="ts">
import LumaIcon from './LumaIcon.vue';
import { studyPreview } from '@/utils/study-content';
withDefaults(defineProps<{ title?: string }>(), { title: '开始学习' });
defineEmits<{ (e: 'menu'): void; (e: 'new'): void }>();
</script>
<template>
  <view class="learning-header">
    <button class="header-button" aria-label="打开学习菜单" @tap="$emit('menu')"><LumaIcon name="menu" :size="21" /></button>
    <text class="header-title">{{ studyPreview(title) }}</text>
    <button class="header-button" aria-label="新建对话" @tap="$emit('new')"><LumaIcon name="compose" :size="20" /></button>
  </view>
</template>
<style scoped>
.learning-header { display:flex; align-items:center; flex-shrink:0; padding:6rpx 26rpx; height:96rpx; border-bottom:1rpx solid #e8ecdf; background:#fafbf7; }
.header-title { flex:1; min-width:0; padding:0 12rpx; font-size:26rpx; font-weight:500; color:#354a37; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.header-button { display:flex; align-items:center; justify-content:center; flex-shrink:0; width:88rpx; height:88rpx; padding:0; margin:0; border:0; background:transparent; border-radius:50%; line-height:1; }
.header-button::after { border:0; }
.header-button:active { background:#edf1e6; }
</style>
