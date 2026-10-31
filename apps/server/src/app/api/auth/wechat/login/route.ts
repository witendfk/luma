import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authService } from '../../../../../services/auth.service';
import { json, withRoute } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';

const LoginBody = z.object({ code: z.string().min(1) });

/** POST /auth/wechat/login —— 校验小程序 code，签发应用会话凭据（FR-01） */
export async function POST(req: NextRequest) {
  return withRoute(req, async () => {
    const { code } = LoginBody.parse(await req.json());
    return json(await authService.login(code));
  });
}
