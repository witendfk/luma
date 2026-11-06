import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();

// 已核实为旧交互验收数据的精确ID。绝不按题目标题或日期推测真实记录。
const legacyIds = [
  'cmvylty1400048oq2tiu80okm', 'cmvymkvmj001e8oq2iqi4i96u',
  'cmvynd1vi00208oq2s3ppeh22', 'cmvyomz1b00598oq2avwsjp6b',
  'cmvyoub69005l8oq2s38fljzc', 'cmw38g0tj003w8ov4ltavxpvt',
];

async function main() {
  const { db } = await import('../src/lib/db');
  try {
    const config = new URL(process.env.DATABASE_URL!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)) throw new Error('只允许清理本机开发库');
    const apply = process.argv.includes('--apply');
    const smokeWhere = { OR: [{ openid: 'dev:smoke' }, { openid: { startsWith: 'dev:smoke-' } }] };
    const selected = { OR: [{ user: smokeWhere }, { id: { in: legacyIds }, user: { openid: 'dev:local-student' } }] };
    const rows = await db.conversation.findMany({ where: selected, include: {
      subjects: true, subjectRevisions: { include: { contextSummaries: true } },
      processTranscripts: true, messages: true, progress: true, collections: true,
      artifacts: { include: { exercises: true, attempts: { include: { answers: true } } } },
      runs: { include: { toolExecutions: true } }, generationJobs: true,
    } });
    if (rows.some((c) => c.runs.some((r) => ['running', 'waiting_job'].includes(r.status)) ||
      c.generationJobs.some((j) => ['queued', 'running'].includes(j.status)))) throw new Error('待清理数据仍有活动任务，停止后再执行');
    const legacy = rows.filter((c) => legacyIds.includes(c.id));
    // 精确名单也要复核：日后若旧记录继续产生真实模型学习，拒绝自动删除。
    if (legacy.some((c) => c.runs.some((r) => {
      const counters = r.counters as { calls?: Array<{ model?: string }> } | null;
      return counters?.calls?.some((call) => call.model && call.model !== 'mock');
    }))) throw new Error('旧记录出现真实模型调用，需重新核对清理范围');
    const users = await db.user.findMany({ where: smokeWhere });
    const attachments = await db.attachment.findMany({ where: { userId: { in: users.map((u) => u.id) } } });
    const report = { apply, conversations: rows.length, legacyConversations: legacy.length,
      smokeUsers: users.length, messages: rows.reduce((n, c) => n + c.messages.length, 0),
      artifacts: rows.reduce((n, c) => n + c.artifacts.length, 0), attachments: attachments.length };
    if (!apply) { console.log(JSON.stringify(report)); return; }
    if (!rows.length && !users.length) { console.log(JSON.stringify(report)); return; }
    const dir = path.resolve(__dirname, '../.luma/cleanup');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const backupPath = path.join(dir, `demo-${Date.now()}.json`);
    // 不包含AuthSession/密钥；在删数据前保存关联数据快照，放在git忽略目录。
    await writeFile(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), report, users, attachments, conversations: rows }), { mode: 0o600, flag: 'wx' });
    await db.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${row.id} FOR UPDATE`;
        const current = await tx.conversation.findUnique({ where: { id: row.id } });
        if (!current || current.updatedAt.getTime() !== row.updatedAt.getTime() ||
          await tx.agentRun.count({ where: { conversationId: row.id, status: { in: ['running', 'waiting_job'] } } }) ||
          await tx.generationJob.count({ where: { conversationId: row.id, status: { in: ['queued', 'running'] } } })) {
          throw new Error('清理范围发生变化，事务回滚；重新核对后再执行');
        }
      }
      const removed = await tx.conversation.deleteMany({ where: { id: { in: rows.map((c) => c.id) } } });
      if (removed.count !== rows.length) throw new Error('清理数量变化，事务回滚');
      await tx.user.deleteMany({ where: { id: { in: users.map((u) => u.id) }, ...smokeWhere } });
    }, { timeout: 30000 });
    console.log(JSON.stringify({ ...report, backupPath, remainingConversations: await db.conversation.count() }));
  } finally { await db.$disconnect(); }
}
main().catch((err) => { console.error(err instanceof Error ? err.message : '清理失败'); process.exitCode = 1; });
