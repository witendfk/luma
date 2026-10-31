import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { subjectService } from '../../../../../../../services/subject.service';
import { json, requireUser, withRoute } from '../../../../../../../lib/http';

export const dynamic = 'force-dynamic';

const ConfirmBody = z.object({
  confirmedSteps: z.unknown(),
});

/** POST /conversations/:id/process-transcripts/:transcriptId/confirm —— 解题过程逐步确认（FR-04 / AC-07） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; transcriptId: string }> },
) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id, transcriptId } = await params;
    const body = ConfirmBody.parse(await req.json());
    return json(await subjectService.confirmTranscript(userId, id, transcriptId, body));
  });
}
