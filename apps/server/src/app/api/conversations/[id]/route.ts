import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { conversationService } from '../../../../services/conversation.service';
import { json, requireUser, withRoute } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

const PatchBody = z.object({
  title: z.string().min(1).max(60).optional(),
  archived: z.boolean().optional(),
});

/** GET /conversations/:id —— 当前题目、进度和材料概览（设计文档 §10） */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    return json(await conversationService.get(userId, id));
  });
}

/** PATCH /conversations/:id —— 重命名、归档、恢复（FR-10）；
 * 微信 wx.request 不支持 PATCH，故同时暴露 PUT 等价入口 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    const body = PatchBody.parse(await req.json());
    return json(await conversationService.update(userId, id, body));
  });
}

export const PUT = PATCH;
