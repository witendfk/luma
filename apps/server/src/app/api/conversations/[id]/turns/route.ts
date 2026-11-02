import type { NextRequest } from 'next/server';
import { TurnRequest } from '@luma/shared';
import { drive } from '../../../../../agent/loop';
import { runService } from '../../../../../services/run.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';
import { sseResponse } from '../../../../../lib/sse';

export const dynamic = 'force-dynamic';

/**
 * POST /conversations/:id/turns —— 消息或学习操作，返回流式事件（设计文档 §10）。
 * 归属校验与幂等在 runService.startRun；重复请求重放已存结果；驱动器负责循环与停靠。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    const input = TurnRequest.parse(await req.json());
    const { run, existing } = await runService.startRun(userId, id, input);

    return sseResponse(async (emit, signal) => {
      if (existing) {
        // 运行中仅返回引用与已存内容，不再启动一次模型调用（§10）
        await runService.replay(run.id, emit);
        return;
      }
      emit({ type: 'run.started', runId: run.id });
      await drive(run.id, emit, signal);
    }, req.signal);
  });
}

/** 供调试确认该路由存在 */
export async function GET() {
  return json({ endpoint: 'turns', method: 'POST', streaming: 'text/event-stream' });
}
