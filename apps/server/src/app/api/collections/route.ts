import type { NextRequest } from 'next/server';
import { ReviewStatus } from '@luma/shared';
import { z } from 'zod';
import { collectionService } from '../../../services/collection.service';
import { json, requireUser, withRoute } from '../../../lib/http';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  view: z.enum(['all', 'question', 'knowledge']).optional(),
  keyword: z.string().max(60).optional(),
  reviewStatus: z.nativeEnum(ReviewStatus).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** GET /collections —— 错题本搜索筛选（FR-09：关键词含知识点，待复习/已复习） */
export async function GET(req: NextRequest) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const query = QuerySchema.parse({
      view: sp.get('view') ?? undefined,
      keyword: sp.get('keyword') ?? undefined,
      reviewStatus: sp.get('reviewStatus') ?? undefined,
      cursor: sp.get('cursor') ?? undefined,
      limit: sp.get('limit') ?? undefined,
    });
    return json(await collectionService.list(userId, query));
  });
}
