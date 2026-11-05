<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import LumaIcon from '@/components/LumaIcon.vue';
const paths = ref<string[]>([]), index = ref(0), failures = ref<string[]>([]);
let storageKey = '';
const top = uni.getSystemInfoSync().statusBarHeight ?? 20;
onLoad((query) => {
  try { storageKey = decodeURIComponent(query?.key ?? ''); } catch { return; }
  if (!/^luma_(ui_)?draft:image-view:image-/.test(storageKey)) return;
  try { const saved = uni.getStorageSync(storageKey); if (Array.isArray(saved?.paths)) { paths.value = saved.paths.filter((p: unknown) => typeof p === 'string').slice(0, 3); index.value = Math.max(0, Math.min(paths.value.length - 1, Number(saved.index) || 0)); } } catch { /* 展示失效状态。 */ }
});
onUnload(() => { if (/^luma_(ui_)?draft:image-view:image-/.test(storageKey)) { try { uni.removeStorageSync(storageKey); } catch { /* 会话退出时清理。 */ } } });
function close(): void { if (getCurrentPages().length > 1) uni.navigateBack(); else uni.switchTab({ url: '/pages/home/index' }); }
</script>
<template>
  <view class="image-viewer"><view class="viewer-header" :style="{ paddingTop: top + 'px' }"><button class="close" aria-label="关闭图片预览" @tap="close"><LumaIcon name="close" white :size="20" /></button><text class="count">{{ paths.length ? `${index + 1} / ${paths.length}` : '图片暂时不可用' }}</text></view>
    <swiper v-if="paths.length" class="images" :current="index" @change="index = $event.detail.current"><swiper-item v-for="path in paths" :key="path"><movable-area class="image-area"><movable-view class="image-mover" direction="all" scale :scale-min="1" :scale-max="4" :scale-value="1"><image v-if="!failures.includes(path)" class="original" :src="path" mode="aspectFit" @error="failures.push(path)" /><text v-else class="expired">图片已失效，请返回更换。</text></movable-view></movable-area></swiper-item></swiper>
    <text class="hint">双指缩放{{ paths.length > 1 ? ' · 左右切换图片' : '' }}</text>
  </view>
</template>
<style scoped>
.image-viewer { height:100vh; display:flex; flex-direction:column; background:#222820; color:#fbfaf5; overflow:hidden; }
.viewer-header { position:relative; display:flex; align-items:center; min-height:96rpx; padding-left:24rpx; flex-shrink:0; }
.close { margin:0; padding:0; border:0; background:transparent; display:flex; align-items:center; justify-content:center; width:88rpx; height:88rpx; }
.close::after { border:0; }
.count { position:absolute; left:25%; right:25%; text-align:center; font-size:24rpx; color:#d3d9cb; pointer-events:none; }
.images { flex:1; min-height:0; }
.image-area,.image-mover { width:100%; height:100%; }
.image-mover { display:flex; align-items:center; justify-content:center; }
.original { width:100%; height:100%; }
.expired { color:#b5bcae; font-size:26rpx; }
.hint { text-align:center; flex-shrink:0; padding:24rpx 20rpx max(40rpx,env(safe-area-inset-bottom)); color:#9ba591; font-size:22rpx; }
</style>
