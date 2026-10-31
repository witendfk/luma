import { request } from '@/utils/request';

/** 上传接口（FR-02）：先取受限上传地址，uni.uploadFile 直传，再 complete 确认可引用 */

export interface UploadTicket {
  uploadId: string;
  objectKey: string;
  url: string;
  maxBytes: number;
  expiresAt: string;
}

export function createUpload(input: {
  purpose: 'question_origin' | 'process_photo' | 'answer_photo' | 'knowledge_material';
  format: string;
  sizeBytes: number;
}): Promise<UploadTicket> {
  return request<UploadTicket>({ method: 'POST', path: '/api/uploads', data: input });
}

export function completeUpload(uploadId: string, objectKey: string): Promise<{ attachmentId: string }> {
  return request<{ attachmentId: string }>({
    method: 'POST',
    path: `/api/uploads/${uploadId}/complete`,
    data: { objectKey },
  });
}
