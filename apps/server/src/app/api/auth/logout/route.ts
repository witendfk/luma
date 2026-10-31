import type { NextRequest } from 'next/server';
import { authService } from '../../../../services/auth.service';
import { bearerToken, json, requireUser, withRoute } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

/** POST /auth/logout —— 退出登录，撤销当前会话凭据（FR-01） */
export async function POST(req: NextRequest) {
  return withRoute(req, async () => {
    const { userId } = await requireUser(req);
    await authService.logout(bearerToken(req));
    return json({ loggedOut: true, userId });
  });
}
