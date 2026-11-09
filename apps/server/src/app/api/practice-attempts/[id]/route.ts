import { z } from 'zod';
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


/** 保存当前题号，不创建作答或提前加载答案。 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    const input = z.object({ exerciseId: z.string().min(1) }).parse(await req.json());
    return json(await practiceService.position(userId, id, input.exerciseId));
  });
}
