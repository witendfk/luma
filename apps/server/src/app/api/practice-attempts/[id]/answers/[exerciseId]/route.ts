import type { NextRequest } from 'next/server';
import { SelfEval } from '@luma/shared';
import { z } from 'zod';
import { practiceService } from '../../../../../../services/practice.service';
import { json, requireUser, withRoute } from '../../../../../../lib/http';

export const dynamic = 'force-dynamic';

const SaveAnswerBody = z.object({
  textDraft: z.string().max(8000).optional(),
  photoIds: z.array(z.string()).max(4).optional(),
  markedUnknown: z.boolean().optional(),
  hintsUsed: z.number().int().min(0).optional(),
  solutionViewedAt: z.string().datetime().optional(),
  selfEval: z.nativeEnum(SelfEval).optional(),
  /** 递增版本：服务端拒绝旧草稿覆盖新草稿（设计文档 §10） */
  draftVersion: z.number().int().min(1),
});

/** PUT /practice-attempts/:id/answers/:exerciseId —— 草稿、照片、提示与自评保存（FR-07/08） */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; exerciseId: string }> },
) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id, exerciseId } = await params;
    const body = SaveAnswerBody.parse(await req.json());
    return json(await practiceService.saveAnswer(userId, id, exerciseId, body));
  });
}
