import { uploadService } from '../../../../services/upload.service';
import { requireUser, withRoute } from '../../../../lib/http';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req), { id } = await params;
    const image = await uploadService.read(userId, id, true);
    return new Response(new Uint8Array(image.bytes), { headers: { 'content-type': `image/${image.format === 'jpg' ? 'jpeg' : image.format}`,
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  });
}
