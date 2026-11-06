<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { clearLegacyPreviewStorage } from '@/utils/legacy-preview';

onLaunch(() => {
  clearLegacyPreviewStorage();
  // 启动时静默恢复登录态；登录态过期由请求层统一抛错后引导重新登录（FR-01）
  useAuthStore()
    .refreshMe()
    .catch(() => undefined);
});
</script>

<style>
page {
  background: #f8f7f2;
  color: #2f3b2f;
  font-size: 28rpx;
  line-height: 1.6;
}
</style>
