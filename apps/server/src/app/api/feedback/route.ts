import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { feedbackService } from '../../../services/feedback.service';
import { json, requireUser, withRoute } from '../../../lib/http';

export const dynamic = 'force-dynamic';

const FeedbackBody = z.object({
  messageId: z.string().optional(),
  artifactId: z.string().optional(),
  kind: z.string().min(1).max(40),
  detail: z.string().max(2000).optional(),
});

/** POST /feedback —— 记录模型内容错误反馈（服务端留存，供教学样例回归） */
export async function POST(req: NextRequest) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const body = FeedbackBody.parse(await req.json());
    return json(await feedbackService.create(userId, body));
  });
}
