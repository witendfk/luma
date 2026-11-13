import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { practiceService } from '../../../../../services/practice.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';
const RedoBody = z.object({ mode: z.enum(['all', 'needs_practice']), requestId: z.string().min(12).max(100).regex(/^[a-zA-Z0-9_-]+$/) }).strict();
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    return json(await practiceService.redo(userId, id, RedoBody.parse(await req.json())));
  });
}
