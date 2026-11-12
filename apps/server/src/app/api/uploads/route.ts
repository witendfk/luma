import type { NextRequest } from 'next/server';
import { CreateUploadRequest } from '@luma/shared';
import { uploadService } from '../../../services/upload.service';
import { json, requireUser, withRoute } from '../../../lib/http';

export const dynamic = 'force-dynamic';

/** POST /uploads —— 获取受限上传地址（FR-02，单张 ≤ 8MB） */
export async function POST(req: NextRequest) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const body = CreateUploadRequest.parse(await req.json());
    return json(await uploadService.create(userId, body));
  });
}
