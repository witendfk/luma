import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { loadWorkerEnv } from '../src/worker/load-env';
loadWorkerEnv();
const base = process.env.LUMA_TEST_BASE ?? 'http://localhost:4000';
async function main() {
  const { db } = await import('../src/lib/db');
  const users: string[] = [], keys: string[] = [];
  let token = '';
  async function api(route: string, data?: unknown) {
    const response = await fetch(base + route, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await response.json();
    assert.equal(body.ok, true, `${route}: ${body.error?.message ?? response.status}`);
    return body.data;
  }
  try {
    const login = await api('/api/auth/wechat/login', { code: `dev:upload-http-${randomUUID()}` });
    token = login.token; users.push(login.userId);
    const conversation = await api('/api/conversations', {});
    const bytes = await sharp({ create: { width: 24, height: 24, channels: 3, background: 'white' } }).png().toBuffer();
    const ticket = await api('/api/uploads', { purpose: 'question_origin', format: 'png', sizeBytes: bytes.length, scope: { conversationId: conversation.id } });
    keys.push(ticket.objectKey, ticket.objectKey.replace('.original', '.vision.png'));
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'photo.png');
    const uploaded = await fetch(base + ticket.url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    assert.equal(uploaded.status, 200); assert.equal((await uploaded.json()).ok, true);
    const ready = await api(`/api/uploads/${ticket.uploadId}/complete`, { objectKey: ticket.objectKey });
    assert.equal((await api(`/api/uploads/${ticket.uploadId}/complete`, { objectKey: ticket.objectKey })).attachmentId, ready.attachmentId);
    const original = await fetch(`${base}/api/attachments/${ready.attachmentId}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(original.status, 200); assert.equal(original.headers.get('cache-control'), 'private, no-store');
    assert.ok(Buffer.from(await original.arrayBuffer()).equals(bytes));
    assert.equal((await fetch(`${base}/api/attachments/${ready.attachmentId}`)).status, 401);
    console.log('PASS 真实HTTP：开发登录→创建会话→凭证→multipart上传→complete幂等→私有原图读取；无凭据401；未创建识别任务/未调用模型');
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
    for (const key of keys) await unlink(path.join(process.cwd(), '.luma', 'uploads', key)).catch(() => {});
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
