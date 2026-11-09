import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { practiceService } from '../../../services/practice.service';
import { json, requireUser, withRoute } from '../../../lib/http';

export const dynamic = 'force-dynamic';

const StartBody = z.object({
  artifactId: z.string().min(1),
  /** 首次开始可选范围；继续同轮次不得改变范围。 */
  exerciseIds: z.array(z.string()).optional(),
});

/** POST /practice-attempts —— 开始或继续最近轮次；显式重做另行实现 */
export async function POST(req: NextRequest) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const body = StartBody.parse(await req.json());
    return json(await practiceService.start(userId, body));
  });
}
