import type { NextRequest } from 'next/server';
import { CreateSubjectRequest } from '@luma/shared';
import { z } from 'zod';
import { subjectService } from '../../../../../services/subject.service';
import { json, requireUser, withRoute } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';

const SubjectBody = z.object({
  subjectId: z.string().optional(),
  action: z.enum(['update', 'confirm']),
  content: z.object({ text: z.string().trim().min(1).max(8000) }).passthrough().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  subquestions: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
  subquestionIndex: z.number().int().min(0).optional(),
  expectedRevision: z.number().int().optional(),
});

/** POST /conversations/:id/subjects —— 修改或确认学习对象版本（FR-03） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    const { id } = await params;
    const raw = await req.json();
    if (!raw.action) return json(await subjectService.create(userId, id, CreateSubjectRequest.parse(raw)));
    const body = SubjectBody.parse(raw);
    return json(await subjectService.update(userId, id, body));
  });
}
