import { z } from 'zod';
import { recognitionService } from '../../../../../../services/recognition.service';
import { json, requireUser, withRoute } from '../../../../../../lib/http';
export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string; jobId: string }> };
export async function GET(req: Request, { params }: Params) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req), { id, jobId } = await params;
    return json(await recognitionService.get(userId, id, jobId));
  });
}
export async function PUT(req: Request, { params }: Params) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req), { id, jobId } = await params;
    const { action } = z.object({ action: z.enum(['cancel', 'retry']) }).parse(await req.json());
    return json(await recognitionService.action(userId, id, jobId, action));
  });
}
