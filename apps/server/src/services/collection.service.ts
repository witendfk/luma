import { notImplemented } from '../lib/errors';

/**
 * 错题收藏（FR-09）：(用户, 会话) 唯一，重复保存只更新关联；
 * 取消收藏仅取消收藏，原对话与练习记录保留。
 */
export const collectionService = {
  /** 搜索筛选：关键词（题干/知识点）、待复习/已复习、错题/讲解/练习视角 */
  async list(
    _userId: string,
    _query: { keyword?: string; reviewStatus?: 'to_review' | 'reviewed'; cursor?: string; limit: number },
  ) {
    throw notImplemented('错题本列表');
  },

  async upsert(_userId: string, _conversationId: string, _input: { note?: string; reviewStatus?: 'to_review' | 'reviewed' }) {
    throw notImplemented('保存收藏');
  },

  async remove(_userId: string, _conversationId: string) {
    throw notImplemented('取消收藏');
  },
};
