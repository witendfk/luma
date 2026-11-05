import type { NextRequest } from 'next/server';
import { ReviewStatus } from '@luma/shared';
import { z } from 'zod';
import { collectionService } from '../../../../services/collection.service';
import { json, requireUser, withRoute } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

const UpsertBody = z.object({
  note: z.string().max(2000).optional(),
  reviewStatus: z.nativeEnum(ReviewStatus).optional(),
});

/** PUT /collections/:subjectId —— 保存/更新收藏、笔记与复习状态（FR-09） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ subjectId: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { subjectId } = await params;
    const body = UpsertBody.parse(await req.json());
    return json(await collectionService.upsert(userId, subjectId, body));
  });
}

/** DELETE /collections/:subjectId —— 取消收藏；原对话与练习记录保留（FR-09） */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ subjectId: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { subjectId } = await params;
    return json(await collectionService.remove(userId, subjectId));
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ subjectId: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { subjectId } = await params;
    return json(await collectionService.get(userId, subjectId));
  });
}
