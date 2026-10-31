import type { NextRequest } from 'next/server';
import { TurnRequest } from '@luma/shared';
import { runTurn, newRunId } from '../../../../../agent/loop';
import { conversationService } from '../../../../../services/conversation.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';
import { sseResponse } from '../../../../../lib/sse';

export const dynamic = 'force-dynamic';

/**
 * POST /conversations/:id/turns —— 消息或学习操作，返回流式事件（设计文档 §10）。
 * 归属校验后进入 Agent 每轮执行循环；事件类型见 @luma/shared/events。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    await conversationService.getOwned(userId, id);
    const input = TurnRequest.parse(await req.json());

    // TODO(第一周)：同一会话同时只允许一轮生成（§4.3），检查运行中的 AgentRun 并返回 CONVERSATION_BUSY
    const runId = newRunId();

    return sseResponse(async (emit, signal) => {
      for await (const event of runTurn({ userId, conversationId: id, runId, requestId: input.requestId, input })) {
        if (signal.aborted) return; // 客户端停止生成：循环内负责落未完成标记
        emit(event);
      }
    }, req.signal);
  });
}

/** 供健康检查或调试确认该路由存在 */
export async function GET() {
  return json({ endpoint: 'turns', method: 'POST', streaming: 'text/event-stream' });
}
