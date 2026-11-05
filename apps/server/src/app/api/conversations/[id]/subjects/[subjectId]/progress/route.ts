import { ProgressRequest } from '@luma/shared';
import type { NextRequest } from 'next/server';
import { subjectService } from '../../../../../../../services/subject.service';
import { json, requireUser, withRoute } from '../../../../../../../lib/http';
export const dynamic = 'force-dynamic';
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; subjectId: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const p = await params;
    const input = ProgressRequest.parse(await req.json());
    return json(await subjectService.progress(userId, p.id, p.subjectId, input));
  });
}
