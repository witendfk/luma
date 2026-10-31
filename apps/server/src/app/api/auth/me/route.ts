import type { NextRequest } from 'next/server';
import { authService } from '../../../../services/auth.service';
import { json, requireUser, withRoute } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

/** GET /auth/me —— 当前账号（FR-01） */
export async function GET(req: NextRequest) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    return json(await authService.me(userId));
  });
}
