import { RecognitionRequest } from '@luma/shared';
import { recognitionService } from '../../../../../services/recognition.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req), { id } = await params;
    return json(await recognitionService.start(userId, id, RecognitionRequest.parse(await req.json())));
  });
}
