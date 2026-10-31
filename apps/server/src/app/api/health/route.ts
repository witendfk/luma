import { db } from '../../../lib/db';
import { json, withRoute } from '../../../lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withRoute(req, async () => {
    let dbStatus = 'up';
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'down';
    }
    return json({
      name: 'luma-server',
      version: '0.1.0',
      db: dbStatus,
      time: new Date().toISOString(),
    });
  });
}
