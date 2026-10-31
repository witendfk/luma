import type { NextRequest } from 'next/server';
import { runService } from '../../../../../services/run.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';

/** POST /runs/:id/cancel —— 取消本轮及其关联未完成任务（设计文档 §10） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    return json(await runService.cancel(userId, id));
  });
}
