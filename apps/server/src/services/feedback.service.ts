import { notImplemented } from '../lib/errors';

/** 模型内容错误反馈（POST /feedback，服务端记录用于教学样例回归） */
export const feedbackService = {
  async create(
    _userId: string,
    _input: { messageId?: string; artifactId?: string; kind: string; detail?: string },
  ) {
    throw notImplemented('内容反馈');
  },
};
