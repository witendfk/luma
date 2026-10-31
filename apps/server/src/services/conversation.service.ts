import { db } from '../lib/db';
import { notFound, notImplemented } from '../lib/errors';

export interface ListConversationsOptions {
  archived: boolean;
  cursor?: string;
  limit: number;
}

export const conversationService = {
  /** 归属校验：所有会话级操作的入口（设计文档 §11：请求中标识均验证本人归属） */
  async getOwned(userId: string, conversationId: string) {
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) throw notFound('会话');
    return conversation;
  },

  /** FR-10：最近学习列表（按 lastActiveAt 排序，前端按今天/昨天/更早分组） */
  async list(_userId: string, _opts: ListConversationsOptions) {
    throw notImplemented('会话列表');
  },

  /** FR-02：创建会话并初始化学习进度（stage=clarifying） */
  async create(_userId: string, _input: { title?: string }) {
    throw notImplemented('创建会话');
  },

  /** FR-10：修改名称、归档、恢复；归档对话发新消息时自动恢复 */
  async update(_userId: string, _conversationId: string, _input: { title?: string; archived?: boolean }) {
    throw notImplemented('更新会话');
  },

  /** FR-10：分页读取消息（游标分页，按时间正序） */
  async messages(_userId: string, _conversationId: string, _opts: { cursor?: string; limit: number }) {
    throw notImplemented('消息列表');
  },
};
