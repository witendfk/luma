import type { TurnRequest, ConversationDetail, ConversationSummary, SubjectView, ProgressView, ProgressRequest, LearningIntent } from '@luma/shared';
export type { ConversationDetail, ConversationSummary, SubjectView, ProgressView, LearningIntent } from '@luma/shared';
import { UI_MOCK } from '@/config';
import { request } from '@/utils/request';
import { queryString } from '@/utils/query';

/** 会话与消息接口（FR-02 / FR-10） */

export interface MessageView {
  id: string;
  runId?: string | null;
  role: 'user' | 'assistant';
  /** 结构化内容块（文本 / 核对卡 / 成果引用），渲染层逐步细化 */
  content: unknown;
  status: 'complete' | 'incomplete';
  createdAt: string;
  subjectRevisionId?: string | null;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export function listConversations(archived: boolean, cursor?: string): Promise<Paged<ConversationSummary>> {
  const query = queryString({ archived: archived ? '1' : '0', cursor });
  return request<Paged<ConversationSummary>>({ method: 'GET', path: `/api/conversations?${query}` });
}

export interface SubjectEdit {
  content: SubjectView['content'];
  tags: string[];
  subquestions: string[];
  subquestionIndex?: number;
  expectedRevision: number;
}

export function updateSubject(id: string, input: SubjectEdit, subjectId?: string): Promise<{ subject: SubjectView; progress?: ProgressView | null }> {
  return request({ method: 'POST', path: subjectId && !UI_MOCK ? `/api/conversations/${id}/subjects/${subjectId}/revisions` : `/api/conversations/${id}/subjects`, data: { ...input, subjectId, action: 'update' } });
}

export function createConversation(input: { title?: string; initialText?: string; subjectType?: 'question' | 'knowledge'; intent?: LearningIntent } = {}): Promise<ConversationSummary> {
  return request<ConversationSummary>({ method: 'POST', path: '/api/conversations', data: input });
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>({ method: 'GET', path: `/api/conversations/${id}` });
}

export function confirmSubject(id: string, version: number, subjectId?: string) {
  return request({ method: 'POST', path: subjectId && !UI_MOCK ? `/api/conversations/${id}/subjects/${subjectId}/confirm` : `/api/conversations/${id}/subjects`, data: { action: 'confirm', subjectId, expectedRevision: version } });
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

export function listMessages(id: string, cursor?: string, subjectId?: string): Promise<Paged<MessageView>> {
  const query = `?${queryString({ cursor, subjectId })}`;
  return request<Paged<MessageView>>({ method: 'GET', path: `/api/conversations/${id}/messages${query}` });
}

/** 发送一轮对话：返回 SSE 响应，请配合 utils/sse 的 openTurnStream 使用 */
export const turnRequestPath = (conversationId: string): string =>
  `/api/conversations/${conversationId}/turns`;

export type { TurnRequest };

export function focusSubject(id: string, subjectId: string, learnAll?: boolean): Promise<ConversationDetail> {
  return request({ method: 'PUT', path: `/api/conversations/${id}/focus`, data: { subjectId, learnAll } });
}
export function saveProgress(id: string, subjectId: string, input: ProgressRequest): Promise<ProgressView> {
  return request({ method: 'PUT', path: `/api/conversations/${id}/subjects/${subjectId}/progress`, data: input });
}
