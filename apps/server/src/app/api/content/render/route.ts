import { z } from 'zod';
import { json, requireUser, withRoute } from '../../../../lib/http';
import { renderContent } from '../../../../lib/content-render';

export const runtime = 'nodejs';
export async function POST(req: Request) {
  return withRoute(req, async () => {
    await requireUser(req);
    const { text } = z.object({ text: z.string().max(12000).refine((s) => (s.match(/\$/g)?.length ?? 0) <= 100, '公式数量过多') }).parse(await req.json());
    return json({ blocks: await renderContent(text) });
  });
}
