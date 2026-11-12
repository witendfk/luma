import { uploadService } from '../../../../../services/upload.service';
import { readUploadForm } from '../../../../../storage/attachments';
import { json, requireUser, withRoute } from '../../../../../lib/http';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req), { id } = await params;
    await uploadService.pending(userId, id);
    await uploadService.write(userId, id, await readUploadForm(req));
    return json({ uploaded: true });
  });
}
