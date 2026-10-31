import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { practiceService } from '../../../services/practice.service';
import { json, requireUser, withRoute } from '../../../lib/http';

export const dynamic = 'force-dynamic';

const StartBody = z.object({
  artifactId: z.string().min(1),
  /** 重做时可选：全部重做省略；部分重做传自评为 partial/stuck 的题目 */
  exerciseIds: z.array(z.string()).optional(),
});

/** POST /practice-attempts —— 开始或重做练习（FR-07：重做创建新轮次，沿用原题） */
export async function POST(req: NextRequest) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const body = StartBody.parse(await req.json());
    return json(await practiceService.start(userId, body));
  });
}
