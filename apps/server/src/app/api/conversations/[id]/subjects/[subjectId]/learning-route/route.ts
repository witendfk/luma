import type { NextRequest } from 'next/server';
import { LearningRouteAction } from '@luma/shared';
import { json, requireUser, withRoute } from '../../../../../../../lib/http';
import { actOnLearningRoute } from '../../../../../../../services/learning-route';
export const dynamic = 'force-dynamic';
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; subjectId: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req), { id, subjectId } = await params;
    return json(await actOnLearningRoute(userId, id, subjectId, LearningRouteAction.parse(await req.json())));
  });
}
