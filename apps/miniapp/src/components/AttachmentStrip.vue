<script setup lang="ts">
import { ref, watch } from 'vue';
import LumaIcon from './LumaIcon.vue';
import { previewAttachment, type LocalAttachment } from '@/utils/attachments';
const props = defineProps<{ images: LocalAttachment[]; readonly?: boolean; replaceable?: boolean }>();
const emit = defineEmits<{ (e: 'replace', index: number): void; (e: 'remove', index: number): void; (e: 'invalid', value: boolean): void }>();
const failed = ref<string[]>([]);
watch(() => props.images.map((image) => image.id).join(','), () => { failed.value = failed.value.filter((id) => props.images.some((image) => image.id === id)); emit('invalid', failed.value.length > 0); });
function error(id: string): void { if (!failed.value.includes(id)) failed.value.push(id); emit('invalid', true); }
</script>
<template>
  <view v-if="images.length" class="attachments">
    <view v-for="(image, index) in images" :key="image.id" class="attachment">
      <button class="thumbnail" :aria-label="`预览${image.name}`" @tap="previewAttachment(images, index)"><image class="thumbnail-image" v-if="!failed.includes(image.id)" :src="image.path" mode="aspectFill" @error="error(image.id)" /><view v-else class="expired"><LumaIcon name="photo" :size="19" /><text>图片失效</text></view><text class="image-index">{{ index + 1 }}</text></button>
      <view v-if="!readonly" class="image-actions"><button v-if="replaceable !== false" class="image-action" :aria-label="`更换第${index + 1}张图片`" @tap="emit('replace', index)">更换</button><button class="image-action" :aria-label="`移除第${index + 1}张图片`" @tap="emit('remove', index)"><LumaIcon name="close" :size="12" /></button></view>
    </view>
  </view>
</template>
<style scoped>
.attachments { display:flex; gap:18rpx; flex-wrap:wrap; padding:8rpx 0 16rpx; }
.attachment { width:144rpx; }
.thumbnail { position:relative; display:block; width:144rpx; height:144rpx; overflow:hidden; margin:0; padding:0; border:0; border-radius:14rpx; background:#eeefe7; }
.thumbnail::after,.image-action::after { border:0; }
.thumbnail-image { display:block; width:100%; height:100%; }
.image-index { position:absolute; bottom:6rpx; left:8rpx; color:#fff; background:rgba(50,63,46,.6); border-radius:4rpx; padding:0 8rpx; font-size:18rpx; }
.image-actions { display:flex; align-items:center; justify-content:space-between; }
.image-action { display:flex; align-items:center; justify-content:center; margin:0; padding:0; min-width:58rpx; min-height:68rpx; line-height:1.6; background:transparent; border:0; border-radius:0; font-size:21rpx; color:#859477; }
.expired { display:flex; height:100%; align-items:center; justify-content:center; flex-direction:column; gap:12rpx; color:#a2947c; font-size:18rpx; }
</style>
