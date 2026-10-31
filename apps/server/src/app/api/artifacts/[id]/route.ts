import type { NextRequest } from 'next/server';
import { artifactService } from '../../../../services/artifact.service';
import { json, requireUser, withRoute } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

/** GET /artifacts/:id —— 按权限与当前阶段返回讲义或题组（作答阶段不下发答案，§8.2） */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    return json(await artifactService.get(userId, id));
  });
}
