import { env } from '../lib/env';
import { notImplemented } from '../lib/errors';

/**
 * 腾讯云 COS 受限上传（FR-02 / 设计文档 §5、§11）。
 * 方案：服务端签发受限上传凭证/临时密钥，小程序 uni.uploadFile 直传；
 * 完成后服务端校验真实类型、大小与可解码性再登记为可引用附件。
 * TODO(部署周)：接入 cos-nodejs-sdk-v5（或自签临时密钥）与私有读访问。
 */
export interface UploadTicket {
  uploadId: string;
  objectKey: string;
  /** uni.uploadFile 的目标地址与所需表单/头 */
  url: string;
  maxBytes: number;
  expiresAt: string;
}

export const cosStorage = {
  isConfigured(): boolean {
    const e = env();
    return Boolean(e.COS_BUCKET && e.COS_SECRET_ID && e.COS_SECRET_KEY);
  },

  async createUploadTicket(
    _userId: string,
    _input: { purpose: string; format: string; sizeBytes: number },
  ): Promise<UploadTicket> {
    if (!this.isConfigured()) {
      throw notImplemented('COS 存储配置（COS_BUCKET / COS_SECRET_ID / COS_SECRET_KEY）');
    }
    throw notImplemented('COS 受限上传凭证签发');
  },

  /** 确认上传：校验通过后返回真实格式与大小，供 upload.service 登记附件 */
  async verifyObject(_objectKey: string): Promise<{ ok: boolean; format?: string; size?: number }> {
    throw notImplemented('COS 对象校验');
  },
};
