import type { TurnRequest } from '@luma/shared';
import { request } from '@/utils/request';
import { queryString } from '@/utils/query';

/** 会话与消息接口（FR-02 / FR-10） */

export interface ConversationSummary {
  id: string;
  title: string;
  lastActiveAt: string;
  archivedAt: string | null;
}

export interface MessageView {
  id: string;
  role: 'user' | 'assistant';
  /** 结构化内容块（文本 / 核对卡 / 成果引用），渲染层逐步细化 */
  content: unknown;
  status: 'complete' | 'incomplete';
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export function listConversations(archived: boolean, cursor?: string): Promise<Paged<ConversationSummary>> {
  const query = queryString({ archived: archived ? '1' : '0', cursor });
  return request<Paged<ConversationSummary>>({ method: 'GET', path: `/api/conversations?${query}` });
}

export interface SubjectView {
  id: string;
  version: number;
  content: { text?: string };
  tags: string[];
  confirmedAt: string | null;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  subject: SubjectView | null;
  progress: { stage: string } | null;
  artifacts: Array<{ id: string; type: 'lesson' | 'exercise_set'; publishStatus: string }>;
  activeRun?: { id: string; status: string } | null;
}

export function createConversation(input: { title?: string; initialText?: string; subjectType?: 'question' | 'knowledge' } = {}): Promise<ConversationSummary> {
  return request<ConversationSummary>({ method: 'POST', path: '/api/conversations', data: input });
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>({ method: 'GET', path: `/api/conversations/${id}` });
}

export function confirmSubject(id: string, version: number) {
  return request({ method: 'POST', path: `/api/conversations/${id}/subjects`, data: { action: 'confirm', expectedRevision: version } });
}

export function cancelRun(id: string) {
  return request({ method: 'POST', path: `/api/runs/${id}/cancel` });
}

export function getRun(id: string): Promise<{ status: string; error: { message: string } | null }> {
  return request({ method: 'GET', path: `/api/runs/${id}` });
}

/** 微信 wx.request 不支持 PATCH，统一用 PUT（服务端两种方法等价接受） */
export function updateConversation(
  id: string,
  patch: { title?: string; archived?: boolean },
): Promise<ConversationSummary> {
  return request<ConversationSummary>({ method: 'PUT', path: `/api/conversations/${id}`, data: patch });
}

export function listMessages(id: string, cursor?: string): Promise<Paged<MessageView>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return request<Paged<MessageView>>({ method: 'GET', path: `/api/conversations/${id}/messages${query}` });
}

/** 发送一轮对话：返回 SSE 响应，请配合 utils/sse 的 openTurnStream 使用 */
export const turnRequestPath = (conversationId: string): string =>
  `/api/conversations/${conversationId}/turns`;

export type { TurnRequest };
