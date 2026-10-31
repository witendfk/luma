import type { NextRequest } from 'next/server';
import { jobService } from '../../../../services/job.service';
import { json, requireUser, withRoute } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

/** GET /jobs/:id —— 任务状态查询；材料页可见时每 2 秒轮询一次（设计文档 §10） */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    return json(await jobService.get(userId, id));
  });
}
