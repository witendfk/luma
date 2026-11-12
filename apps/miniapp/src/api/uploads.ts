import type { CreateUploadRequest, UploadTicket, RecognitionRequest, RecognitionView } from '@luma/shared';
import { request } from '@/utils/request';
import { API_BASE } from '@/config';
import { getToken, sessionVersion, clearToken } from '@/utils/token';
import type { LocalAttachment } from '@/utils/attachments';
export type { UploadTicket };
export const createUpload = (input: CreateUploadRequest) => request<UploadTicket>({ method: 'POST', path: '/api/uploads', data: input });
export const completeUpload = (id: string, objectKey: string) => request<{ attachmentId: string }>({ method: 'POST', path: `/api/uploads/${id}/complete`, data: { objectKey } });

/** Reuse completed files on an explicit retry; never send a local path as a model source. */
export async function uploadAttachments(images: LocalAttachment[], purpose: CreateUploadRequest['purpose'], scope: CreateUploadRequest['scope'], onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const session = sessionVersion(), token = getToken();
  const current = () => { if (!token || session !== sessionVersion() || token !== getToken()) throw new Error('登录状态已变化，请重新操作'); };
  const scopeKey = JSON.stringify({ purpose, scope }), ids: string[] = [];
  for (const image of images) {
    current();
    if (image.remote?.scopeKey === scopeKey) { ids.push(image.remote.id); onProgress?.(ids.length, images.length); continue; }
    const info = await new Promise<UniApp.GetImageInfoSuccessData>((resolve, reject) => uni.getImageInfo({ src: image.path, success: resolve, fail: () => reject(new Error('图片无法读取，请重新选择')) }));
    const size = image.size ?? await new Promise<number>((resolve, reject) => uni.getFileInfo({ filePath: image.path, success: (r) => resolve(r.size), fail: () => reject(new Error('图片无法读取，请重新选择')) }));
    current();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(info.type ?? '')) throw new Error('请选择 JPG、PNG 或 WebP 图片');
    const ticket = await createUpload({ purpose, scope, format: info.type as CreateUploadRequest['format'], sizeBytes: size });
    current();
    // Only same-server relative URLs are allowed; never send the session credential to another host.
    if (!/^\/api\/uploads\/[^/]+\/file$/.test(ticket.url)) throw new Error('上传地址无效');
    await new Promise<void>((resolve, reject) => uni.uploadFile({ url: API_BASE + ticket.url, filePath: image.path, name: 'file',
      header: { Authorization: `Bearer ${token}` }, timeout: 60_000,
      success: (res) => {
        try {
          current();
          const body = JSON.parse(res.data);
          if (res.statusCode >= 200 && res.statusCode < 300 && body.ok === true) resolve();
          else { if (body.error?.code === 'UNAUTHENTICATED') clearToken(); reject(new Error(body.error?.message ?? '图片上传失败，请重试')); }
        } catch (error) { reject(error instanceof Error ? error : new Error('图片上传响应异常')); }
      }, fail: () => reject(new Error('图片上传中断，已保留所选图片，请重试')),
    }));
    current();
    const completed = await completeUpload(ticket.uploadId, ticket.objectKey);
    current(); image.remote = { id: completed.attachmentId, scopeKey };
    ids.push(completed.attachmentId); onProgress?.(ids.length, images.length);
  }
  return ids;
}
export const startRecognition = (id: string, input: RecognitionRequest) => request<RecognitionView>({ method: 'POST', path: `/api/conversations/${id}/recognitions`, data: input });
export const getRecognition = (id: string, jobId: string) => request<RecognitionView>({ method: 'GET', path: `/api/conversations/${id}/recognitions/${jobId}` });
export const actOnRecognition = (id: string, jobId: string, action: 'retry' | 'cancel') => request<RecognitionView>({ method: 'PUT', path: `/api/conversations/${id}/recognitions/${jobId}`, data: { action } });
export const confirmTranscript = (id: string, transcriptId: string, steps: string[]) => request({ method: 'POST', path: `/api/conversations/${id}/process-transcripts/${transcriptId}/confirm`, data: { confirmedSteps: steps } });
export async function previewRemoteAttachments(ids: string[]): Promise<void> {
  const session = sessionVersion(), token = getToken();
  if (!token) return;
  try {
    const paths = await Promise.all(ids.map((id) => new Promise<string>((resolve, reject) => uni.downloadFile({
      url: `${API_BASE}/api/attachments/${encodeURIComponent(id)}`, header: { Authorization: `Bearer ${token}` },
      success: (res) => res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error('原图暂时无法读取')),
      fail: () => reject(new Error('原图加载失败，请重试')),
    }))));
    if (session === sessionVersion()) uni.previewImage({ urls: paths, current: paths[0] });
  } catch (error) { if (session === sessionVersion()) uni.showToast({ title: error instanceof Error ? error.message : '原图加载失败', icon: 'none' }); }
}
