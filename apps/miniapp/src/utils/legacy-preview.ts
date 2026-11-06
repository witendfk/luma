/** 清除旧交互验收缓存；保留真实账号、草稿和阅读位置。可重复执行。 */
export function clearLegacyPreviewStorage(): void {
  try {
    for (const key of uni.getStorageInfoSync().keys) {
      if (key.startsWith('luma_ui_preview:') || key.startsWith('luma_ui_draft:') ||
        key.startsWith('luma_draft:study-preview:')) {
        uni.removeStorageSync(key);
      }
    }
    if (uni.getStorageSync('luma_token') === 'luma-ui-preview-only') uni.removeStorageSync('luma_token');
  } catch {
    // 本次无法访问存储时，下次启动继续清理；不会切回示例模式。
  }
}
