import { ReviseSubjectRequest } from '@luma/shared';
import type { NextRequest } from 'next/server';
import { subjectService } from '../../../../../../../services/subject.service';
import { json, requireUser, withRoute } from '../../../../../../../lib/http';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; subjectId: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const p = await params;
    const input = ReviseSubjectRequest.parse(await req.json());
    return json(await subjectService.update(userId, p.id, { expectedRevision: input.expectedRevision, subjectId: p.subjectId, action: 'confirm' }));
  });
}
