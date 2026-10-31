import type { JobView } from '@luma/shared';
import { request } from '@/utils/request';

/** 生成任务状态（FR-11）：材料页可见时每 2 秒查询一次，完成/失败/离开后停止 */

export function getJob(id: string): Promise<JobView> {
  return request<JobView>({ method: 'GET', path: `/api/jobs/${id}` });
}

export function retryJob(id: string): Promise<JobView> {
  return request<JobView>({ method: 'POST', path: `/api/jobs/${id}/retry` });
}
