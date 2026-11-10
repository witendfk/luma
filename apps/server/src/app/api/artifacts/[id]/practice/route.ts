import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getLessonPractice } from '../../../../../services/lesson-practice';
import { json, requireUser, withRoute } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';
/** Read-only resolution: opening an entry never generates exercises or reveals their answers. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    const version = z.coerce.number().int().positive().parse(req.nextUrl.searchParams.get('version'));
    return json(await getLessonPractice(userId, id, version));
  });
}
