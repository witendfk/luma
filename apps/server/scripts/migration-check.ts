import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { loadWorkerEnv } from '../src/worker/load-env';

// Isolated schema: exercise the actual old DDL + actual migration with populated legacy rows.
loadWorkerEnv();
const schema = `migration_check_${randomUUID().replaceAll('-', '')}`;
const admin = new PrismaClient();
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasourceUrl: url.toString() });
async function sqlFile(path: string) {
  const sql = await readFile(new URL(path, import.meta.url), 'utf8');
  // These migrations contain plain DDL/DML, no procedural blocks or semicolons in literals.
  await db.$transaction(async (tx) => {
    for (const part of sql.replace(/^BEGIN;|^COMMIT;/gm, '').split(';').filter((s) => s.trim())) await tx.$executeRawUnsafe(part);
  });
}
async function main() {
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await sqlFile('../prisma/migrations/20261031152432_agent_orchestration/migration.sql');
    const fixture = [
      `INSERT INTO "User" (id,openid,"updatedAt") VALUES ('u','migration-fixture',now())`,
      `INSERT INTO "Conversation" (id,"userId",title,"updatedAt") VALUES ('c','u','旧题',now()),('empty','u','空对话',now())`,
      `INSERT INTO "SubjectRevision" (id,"conversationId",version,type,content,tags,"confirmedAt") VALUES ('r1','c',1,'question','{"text":"原题"}',ARRAY['函数'],now()),('r2','c',2,'question','{"text":"修订题"}',ARRAY['函数'],now())`,
      `INSERT INTO "Artifact" (id,"conversationId","subjectRevisionId",type,version,content,"publishStatus","updatedAt") VALUES ('a','c','r1','exercise_set',1,'{}','published',now())`,
      `INSERT INTO "Exercise" (id,"artifactId","order",stem,topic,difficulty,purpose,answer,analysis) VALUES ('e','a',1,'旧练习','函数','basic','巩固','1','解析')`,
      `INSERT INTO "PracticeAttempt" (id,"artifactId","userId","exerciseIds",stage,"updatedAt") VALUES ('attempt','a','u','["e"]','summary',now())`,
      `INSERT INTO "PracticeAnswer" (id,"attemptId","exerciseId","textDraft","draftVersion","updatedAt") VALUES ('answer','attempt','e','我的旧草稿',3,now())`,
      `INSERT INTO "Message" (id,"conversationId",role,content) VALUES ('m','c','user','{"blocks":[{"type":"text","text":"旧消息"}]}')`,
      `INSERT INTO "LearningProgress" (id,"conversationId","subjectRevisionId","currentArtifactId","updatedAt") VALUES ('p','c','r2','a',now())`,
      `INSERT INTO "CollectionEntry" (id,"userId","conversationId",note,"reviewStatus","updatedAt") VALUES ('col','u','c','保留这份笔记','reviewed',now())`,
      `INSERT INTO "AgentRun" (id,"conversationId","subjectRevisionId","requestId","promptVersion",status) VALUES ('run','c','r1','legacy-request','v1','completed')`,
      `INSERT INTO "GenerationJob" (id,type,"conversationId","subjectRevisionId",status,"updatedAt") VALUES ('job','exercise_set','c','r1','succeeded',now())`,
    ];
    for (const sql of fixture) await db.$executeRawUnsafe(sql);
    const tables = ['User', 'Conversation', 'SubjectRevision', 'Message', 'LearningProgress', 'CollectionEntry', 'Artifact', 'Exercise', 'PracticeAttempt', 'PracticeAnswer', 'AgentRun', 'GenerationJob'];
    const snapshots = new Map<string, Record<string, unknown>[]>();
    for (const table of tables) snapshots.set(table, await db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY id`));
    await sqlFile('../prisma/migrations/20261105090000_learning_subjects/migration.sql');
    await db.$disconnect(); // discard prepared SELECT * plans from before DDL

    for (const table of tables) {
      const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${table}" ORDER BY id`);
      for (const old of snapshots.get(table)!) {
        const current = rows.find((row) => row.id === old.id)!;
        assert.ok(current, `${table}: legacy row missing`);
        for (const key of Object.keys(old)) assert.deepEqual(current[key], old[key], `${table}.${key}: legacy value changed`);
      }
    }
    assert.equal(await db.learningSubject.count(), 2);
    const row = await db.conversation.findUniqueOrThrow({ where: { id: 'c' } });
    assert.equal(row.activeSubjectId, 'legacy_c');
    assert.equal(await db.subjectRevision.count({ where: { subjectId: 'legacy_c' } }), 2);
    assert.equal((await db.message.findUniqueOrThrow({ where: { id: 'm' } })).subjectId, 'legacy_c');
    assert.ok(await db.learningProgress.findUnique({ where: { subjectId: 'legacy_empty' } }));
    console.log('PASS 真实迁移保留全部旧字段、两版原题、旧消息、成果、作答草稿和收藏笔记；空会话补首对象与进度');
  } finally {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
