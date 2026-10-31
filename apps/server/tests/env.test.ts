import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from '../src/lib/env';
import { replaceMethod } from './helpers/mock';

const database = 'postgresql://review:review@localhost:5432/review';

test('示例中的空可选配置可用于启动，非法非空 URL 仍被拒绝', () => {
  const parsed = parseEnv({ DATABASE_URL: database, OPENAI_BASE_URL: '', COS_BUCKET: '  ' });
  assert.equal(parsed.OPENAI_BASE_URL, undefined);
  assert.equal(parsed.COS_BUCKET, undefined);
  assert.throws(() => parseEnv({ DATABASE_URL: database, OPENAI_BASE_URL: 'not a url' }), /OPENAI_BASE_URL/);
});

test('生产和测试环境拒绝假登录，开发环境仍可显式启用', () => {
  for (const NODE_ENV of ['production', 'test']) {
    assert.throws(() => parseEnv({ DATABASE_URL: database, NODE_ENV, LUMA_DEV_FAKE_LOGIN: 'true' }), /LUMA_DEV_FAKE_LOGIN/);
  }
  assert.equal(parseEnv({ DATABASE_URL: database, NODE_ENV: 'development', LUMA_DEV_FAKE_LOGIN: '1' }).LUMA_DEV_FAKE_LOGIN, true);
});

test('独立 worker 使用 Next.js 环境文件优先级，不依赖当前目录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-env-test-'));
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'LUMA_ENV_PROBE=base\n');
    fs.writeFileSync(path.join(dir, '.env.development.local'), 'LUMA_ENV_PROBE=development-local\n');
    const entry = path.resolve(__dirname, '../src/worker/load-env.ts');
    const script = `require(${JSON.stringify(entry)}).loadWorkerEnv(${JSON.stringify(dir)}); console.log(process.env.LUMA_ENV_PROBE)`;
    const result = execFileSync(process.execPath, ['--require', require.resolve('tsx/cjs'), '-e', script], {
      cwd: os.tmpdir(), env: { PATH: process.env.PATH, NODE_ENV: 'development' }, encoding: 'utf8',
    });
    assert.match(result, /development-local/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('假登录拒绝普通 code 和空身份，不将不同微信用户归到统一账号', async (t) => {
  Object.assign(process.env, { NODE_ENV: 'development' });
  process.env.DATABASE_URL = database;
  process.env.LUMA_DEV_FAKE_LOGIN = 'true';
  delete process.env.OPENAI_BASE_URL;
  const { db } = await import('../src/lib/db');
  const { wechatLogin } = await import('../src/lib/auth');
  const identities: string[] = [];
  replaceMethod(t, db.user, 'upsert', async ({ where }: any) => {
    identities.push(where.openid);
    return { id: where.openid };
  });
  replaceMethod(t, db.authSession, 'create', async () => ({}));
  for (const code of ['actual-wechat-code', 'dev:', 'dev:   ']) {
    await assert.rejects(wechatLogin(code), /开发登录凭证/);
  }
  await wechatLogin('dev:teacher-A');
  await wechatLogin('dev:teacher-B');
  assert.deepEqual(identities, ['dev:teacher-A', 'dev:teacher-B']);
});
