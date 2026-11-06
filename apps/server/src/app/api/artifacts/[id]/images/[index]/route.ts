import { db } from '../../../../../../lib/db';
import { withRoute, requireUser } from '../../../../../../lib/http';
import { notFound } from '../../../../../../lib/errors';
import { readLessonImage } from '../../../../../../storage/lesson-images';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req), { id, index } = await params;
    if (!/^\d$/.test(index)) throw notFound('教学图片');
    const artifact = await db.artifact.findFirst({ where: { id, type: 'lesson', publishStatus: 'published', conversation: { userId } } });
    const key = (artifact?.content as { lesson?: { illustrations?: Array<{ imageKey?: string }> } } | undefined)?.lesson?.illustrations?.[Number(index)]?.imageKey;
    if (!key) throw notFound('教学图片');
    let bytes: Buffer;
    try { bytes = await readLessonImage(key); } catch { throw notFound('教学图片'); }
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  });
}
