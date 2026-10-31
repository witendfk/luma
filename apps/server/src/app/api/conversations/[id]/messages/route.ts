import type { NextRequest } from 'next/server';
import { conversationService } from '../../../../../services/conversation.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';

/** GET /conversations/:id/messages —— 分页读取消息（FR-10 历史恢复） */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    const sp = req.nextUrl.searchParams;
    return json(
      await conversationService.messages(userId, id, {
        cursor: sp.get('cursor') ?? undefined,
        limit: Number(sp.get('limit') ?? 30),
      }),
    );
  });
}
