import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { conversationService } from '../../../services/conversation.service';
import { json, requireUser, withRoute } from '../../../lib/http';

export const dynamic = 'force-dynamic';

const CreateConversationBody = z.object({
  title: z.string().max(60).optional(),
  subjectType: z.enum(['question', 'knowledge']).optional(),
  intent: z.enum(['question', 'knowledge', 'practice']).optional(),
  initialText: z.string().max(8000).optional(),
});

/** GET /conversations —— 最近学习或归档列表（FR-10） */
export async function GET(req: NextRequest) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const sp = req.nextUrl.searchParams;
    return json(
      await conversationService.list(userId, {
        archived: sp.get('archived') === '1',
        cursor: sp.get('cursor') ?? undefined,
        limit: Number(sp.get('limit') ?? 20),
      }),
    );
  });
}

/** POST /conversations —— 新建会话（FR-02：每次新建围绕一题或一个知识点） */
export async function POST(req: NextRequest) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const body = CreateConversationBody.parse(await req.json().catch(() => ({})));
    return json(await conversationService.create(userId, body));
  });
}
