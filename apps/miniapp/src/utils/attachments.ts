import { UI_MOCK } from '@/config';
export interface LocalAttachment { id: string; path: string; name: string; sample?: boolean }
export const MAX_IMAGES = 3;
const makeId = () => `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** 只选择本机图片；本轮没有上传请求或视觉识别。 */
export async function chooseAttachments(count = MAX_IMAGES): Promise<LocalAttachment[] | null> {
  const options = ['拍照', '从相册选择', ...(UI_MOCK ? ['使用多题示例'] : [])];
  const action = await new Promise<number | null>((resolve) => uni.showActionSheet({ itemList: options, success: (res) => resolve(res.tapIndex), fail: () => resolve(null) }));
  if (action === null) return null;
  if (action === 2) return [{ id: makeId(), path: '/static/preview/question-sheet.png', name: '数学练习 · 三道题', sample: true }];
  return new Promise((resolve) => uni.chooseImage({
    count: Math.max(1, count), sizeType: ['original'], sourceType: [action === 0 ? 'camera' : 'album'],
    success: (res) => {
      const files = res.tempFiles as Array<{ path: string; size: number }>;
      if (files.some((file) => file.size > 8 * 1024 * 1024)) {
        uni.showToast({ title: '单张图片不能超过 8 MB，请重新选择', icon: 'none' }); resolve(null); return;
      }
      resolve(files.map((file, index) => ({ id: makeId(), path: file.path, name: `图片 ${index + 1}` })));
    },
    fail: (err) => {
      if (!/cancel/i.test(err.errMsg)) uni.showToast({ title: '未能选择图片，请重试或检查相机、相册权限', icon: 'none' });
      resolve(null);
    },
  }));
}
export function previewAttachment(images: LocalAttachment[], index: number): void {
  // 使用独立全屏页，包内示例与本机照片保持同样的缩放、切图和返回体验。
  const paths = images.map((item) => item.sample && item.path === '/static/preview/question-sheet.svg' ? '/static/preview/question-sheet.png' : item.path);
  if (!paths[index]) return;
  const failed = () => uni.showToast({ title: '图片暂时无法预览，请返回更换图片', icon: 'none' });
  const key = `${UI_MOCK ? 'luma_ui_draft:' : 'luma_draft:'}image-view:${makeId()}`;
  try { uni.setStorageSync(key, { paths, index }); uni.navigateTo({ url: `/pages/image-preview/index?key=${encodeURIComponent(key)}`, fail: () => { uni.removeStorageSync(key); failed(); } }); }
  catch { failed(); }
}
