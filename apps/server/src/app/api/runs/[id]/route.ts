import type { NextRequest } from 'next/server';
import { db } from '../../../../lib/db';
import { notFound } from '../../../../lib/errors';
import { json, requireUser, withRoute } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

/** 前台连接释放后仅查询运行状态，不重新调用模型，不暴露协议与提示词。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    const run = await db.agentRun.findFirst({ where: { id, conversation: { userId } }, select: { id: true, status: true, error: true } });
    if (!run) throw notFound('运行');
    return json(run);
  });
}
