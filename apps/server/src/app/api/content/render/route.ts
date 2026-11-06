import { z } from 'zod';
import { json, requireUser, withRoute } from '../../../../lib/http';
import { renderContent } from '../../../../lib/content-render';
import { TeachingReply } from '@luma/shared';

export const runtime = 'nodejs';
export async function POST(req: Request) {
  return withRoute(req, async () => {
    await requireUser(req);
    const { text, content } = z.object({ text: z.string().max(14000).refine((s) => (s.match(/\$/g)?.length ?? 0) <= 128, '公式数量过多'), content: TeachingReply.optional() }).parse(await req.json());
    const blocks = await renderContent(text, content);
    return json({ blocks, failed: blocks.some((block) => block.failed) });
  });
}
