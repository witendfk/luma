import type { NextRequest } from 'next/server';
import { jobService } from '../../../../../services/job.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';

/** POST /jobs/:id/retry —— 失败任务重试（FR-11：重试不重复保存材料） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    return json(await jobService.retry(userId, id));
  });
}
