import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { uploadService } from '../../../services/upload.service';
import { json, requireUser, withRoute } from '../../../lib/http';

export const dynamic = 'force-dynamic';

const CreateUploadBody = z.object({
  purpose: z.enum(['question_origin', 'process_photo', 'answer_photo', 'knowledge_material']),
  format: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

/** POST /uploads —— 获取受限上传地址（FR-02，单张 ≤ 8MB） */
export async function POST(req: NextRequest) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const body = CreateUploadBody.parse(await req.json());
    return json(await uploadService.create(userId, body));
  });
}
