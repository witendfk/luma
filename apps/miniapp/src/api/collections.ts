import type { ReviewStatus } from '@luma/shared';
import { request } from '@/utils/request';
import { queryString } from '@/utils/query';

/** 错题收藏接口（FR-09）：用户×会话唯一，重复保存只更新 */

export interface CollectionView {
  id: string;
  conversationId: string;
  title: string;
  tags: string[];
  note: string | null;
  reviewStatus: ReviewStatus;
  collectedAt: string;
}

export interface CollectionQuery {
  keyword?: string;
  reviewStatus?: ReviewStatus;
  cursor?: string;
  limit?: number;
}

export function listCollections(query: CollectionQuery = {}): Promise<{ items: CollectionView[]; nextCursor: string | null }> {
  const qs = queryString({ ...query });
  return request({ method: 'GET', path: `/api/collections${qs ? `?${qs}` : ''}` });
}

export function saveCollection(
  conversationId: string,
  input: { note?: string; reviewStatus?: ReviewStatus },
): Promise<void> {
  return request<void>({ method: 'PUT', path: `/api/collections/${conversationId}`, data: input });
}

export function removeCollection(conversationId: string): Promise<void> {
  return request<void>({ method: 'DELETE', path: `/api/collections/${conversationId}` });
}
