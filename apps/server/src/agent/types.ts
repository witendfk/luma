import type { TurnRequest } from '@luma/shared';

/** 一轮对话的执行上下文：归属校验在路由层完成后传入 */
export interface TurnContext {
  userId: string;
  conversationId: string;
  runId: string;
  requestId: string;
  input: TurnRequest;
}
