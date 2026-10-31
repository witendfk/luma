import type { NextRequest } from 'next/server';
import { practiceService } from '../../../../services/practice.service';
import { json, requireUser, withRoute } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

/** GET /practice-attempts/:id —— 题目、进度及本人作答（题目侧投影，不含答案） */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    return json(await practiceService.get(userId, id));
  });
}
