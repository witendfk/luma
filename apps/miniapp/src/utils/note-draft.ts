const key = (id: string) => `luma_ui_draft:note:${id}`;

export function readNoteDraft(id: string, savedNote: string): string {
  try {
    const saved = uni.getStorageSync(key(id));
    // 微信无缓存时返回空字符串；空白草稿用对象保存，以便区分。
    return saved && typeof saved === 'object' && typeof saved.text === 'string' ? saved.text : savedNote;
  } catch { return savedNote; }
}
export function rememberNoteDraft(id: string, draft: string, savedNote: string): boolean {
  try {
    if (draft === savedNote) uni.removeStorageSync(key(id));
    else uni.setStorageSync(key(id), { text: draft });
    return true;
  } catch { return false; }
}
export function clearNoteDraft(id: string): void { uni.removeStorageSync(key(id)); }
