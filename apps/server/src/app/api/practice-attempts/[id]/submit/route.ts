import type { NextRequest } from 'next/server';
import { practiceService } from '../../../../../services/practice.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';

/** POST /practice-attempts/:id/submit —— 提交作答进入自评，返回参考解析（FR-08） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    return json(await practiceService.submit(userId, id));
  });
}
