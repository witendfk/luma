import { randomUUID } from 'node:crypto';
import { CreateUploadRequest, type UploadTicket } from '@luma/shared';
import { db } from '../lib/db';
import { invalidFormat, notFound } from '../lib/errors';
import { requireLocalUploads, readUploadBytes, saveUploadBytes, validateUploadImage } from '../storage/attachments';
export const uploadService = {
  async create(userId: string, raw: CreateUploadRequest): Promise<UploadTicket> {
    const input = CreateUploadRequest.parse(raw);
    requireLocalUploads();
    const conversation = await db.conversation.findFirst({ where: { id: input.scope.conversationId, userId } });
    if (!conversation) throw notFound('会话');
    if (input.purpose === 'process_photo' && !input.scope.subjectRevisionId) throw invalidFormat('过程照片需要关联当前题目版本');
    if (input.scope.subjectRevisionId && !await db.subjectRevision.findFirst({ where: { id: input.scope.subjectRevisionId, conversationId: conversation.id } })) throw notFound('学习对象版本');
    const objectKey = `${randomUUID()}.original`, expiresAt = new Date(Date.now() + 15 * 60_000);
    const row = await db.attachment.create({ data: { userId, objectKey, purpose: input.purpose, format: input.format,
      size: input.sizeBytes, status: 'pending', storageProvider: 'local', scope: input.scope, uploadExpiresAt: expiresAt } });
    return { uploadId: row.id, objectKey, url: `/api/uploads/${row.id}/file`, maxBytes: 8 * 1024 * 1024, expiresAt: expiresAt.toISOString() };
  },
  async pending(userId: string, id: string) {
    const row = await db.attachment.findFirst({ where: { id, userId, storageProvider: 'local' } });
    if (!row) throw notFound('附件');
    if (row.status !== 'pending' || !row.uploadExpiresAt || row.uploadExpiresAt <= new Date()) throw invalidFormat('上传凭证已过期或已完成，请重新选择图片');
    return row;
  },
  async write(userId: string, id: string, bytes: Uint8Array) {
    const row = await this.pending(userId, id);
    if (bytes.byteLength !== row.size) throw invalidFormat('上传文件大小不符，请重新选择图片');
    await validateUploadImage(bytes, row.format);
    await saveUploadBytes(row.objectKey, bytes);
  },

  /** 确认上传完成：校验可解码性后登记 Attachment，返回可引用的附件标识 */
  async complete(userId: string, id: string, input: { objectKey: string }) {
    const row = await db.attachment.findFirst({ where: { id, userId, storageProvider: 'local' } });
    if (!row || row.objectKey !== input.objectKey) throw notFound('附件');
    if (row.status === 'ready') return { attachmentId: row.id };
    await this.pending(userId, id);
    const bytes = await readUploadBytes(row.objectKey);
    if (bytes.byteLength !== row.size) throw invalidFormat('上传文件大小不符');
    const verified = await validateUploadImage(bytes, row.format);
    const previewObjectKey = row.objectKey.replace('.original', '.vision.png');
    await saveUploadBytes(previewObjectKey, verified.preview);
    await db.attachment.updateMany({ where: { id, userId, status: 'pending', uploadExpiresAt: { gt: new Date() } },
      data: { status: 'ready', previewObjectKey, format: verified.format } });
    if (!await db.attachment.findFirst({ where: { id, userId, status: 'ready' } })) throw invalidFormat('上传凭证已过期，请重新选择图片');
    return { attachmentId: row.id };
  },
  async read(userId: string, id: string, original = false) {
    const row = await db.attachment.findFirst({ where: { id, userId, status: 'ready', storageProvider: 'local' } });
    if (!row?.previewObjectKey) throw notFound('可读取的附件');
    return { bytes: await readUploadBytes(original ? row.objectKey : row.previewObjectKey), format: original ? row.format : 'png' };
  },
};
