import { notImplemented } from '../lib/errors';

/**
 * 上传（FR-02 / 设计文档 §10）：获取受限上传地址，确认文件有效并可引用。
 * 校验格式、真实文件类型、8MB 限制与可解码性；私有对象访问（§11）。
 */
export const uploadService = {
  async create(
    _userId: string,
    _input: { purpose: 'question_origin' | 'process_photo' | 'answer_photo' | 'knowledge_material'; format: string; sizeBytes: number },
  ) {
    throw notImplemented('受限上传地址');
  },

  /** 确认上传完成：校验可解码性后登记 Attachment，返回可引用的附件标识 */
  async complete(_userId: string, _uploadId: string, _input: { objectKey: string }) {
    throw notImplemented('上传确认');
  },
};
