import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { uploadService } from '../../../../../services/upload.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';

const CompleteBody = z.object({ objectKey: z.string().min(1) });

/** POST /uploads/:id/complete —— 确认文件有效并可引用（设计文档 §10） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    const body = CompleteBody.parse(await req.json());
    return json(await uploadService.complete(userId, id, body));
  });
}
