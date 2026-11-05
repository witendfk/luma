import type { NextRequest } from 'next/server';
import { practiceService } from '../../../../../services/practice.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const p = await params;
    return json(await practiceService.history(userId, p.id));
  });
}
