import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { CreateUploadRequest, MAX_UPLOAD_BYTES, RecognitionRequest } from '@luma/shared';
import { readUploadForm, validateUploadImage } from '../src/storage/attachments';
import { parseRecognition } from '../src/jobs/recognition.task';
import { miniappSandbox, storageMock } from './helpers/miniapp';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

test('上传校验真实解码、格式匹配、8MB及方向校正；拒绝伪装图片和截断文件', async () => {
  const image = await sharp({ create: { width: 120, height: 60, channels: 3, background: 'white' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const verified = await validateUploadImage(image, 'jpg');
  const meta = await sharp(verified.preview).metadata();
  assert.equal(meta.width, 60); assert.equal(meta.height, 120); assert.equal(meta.orientation, undefined);
  assert.equal(verified.format, 'jpeg');
  await assert.rejects(validateUploadImage(image, 'png'), /格式不符/);
  await assert.rejects(validateUploadImage(Buffer.from('<svg></svg>'), 'png'), /格式不符/);
  await assert.rejects(validateUploadImage(image.subarray(0, 150), 'jpg'), /文件损坏/);
  await assert.rejects(validateUploadImage(new Uint8Array(MAX_UPLOAD_BYTES + 1), 'png'), /8 MB/);
  assert.equal(CreateUploadRequest.safeParse({ purpose: 'question_origin', format: 'pdf', sizeBytes: 1, scope: { conversationId: 'c' } }).success, false);
});

test('multipart按实际流大小设上限，正常文件可读，重复文件和伪造小Content-Length仍拒绝', async () => {
  const data = new FormData(); data.append('file', new Blob(['image']), 'photo.png');
  assert.equal(Buffer.from(await readUploadForm(new Request('http://local/upload', { method: 'POST', body: data }))).toString(), 'image');
  data.append('file', new Blob(['other']), 'other.png');
  await assert.rejects(readUploadForm(new Request('http://local/upload', { method: 'POST', body: data })), /每次上传一张/);
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_UPLOAD_BYTES + 70_000)); c.close(); } });
  await assert.rejects(readUploadForm(new Request('http://local/upload', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test', 'content-length': '1' }, body, duplex: 'half' } as RequestInit)), /8 MB/);
});

test('识别结构分独立题和小问，拒绝空内容、跨图引用及将过程错当题目', () => {
  const item = { text: '已知条件', imageIndexes: [0], subquestions: ['第一问', '第二问'], uncertainties: ['符号不清'], tags: [] };
  const result = { items: [item, { ...item, text: '另一独立题' }], steps: [], uncertainties: [] };
  assert.equal(parseRecognition(JSON.stringify(result), 'question', 1).items.length, 2);
  assert.throws(() => parseRecognition(JSON.stringify(result), 'process', 1));
  assert.throws(() => parseRecognition(JSON.stringify({ ...result, items: [{ ...item, imageIndexes: [2] }] }), 'question', 1));
  assert.throws(() => parseRecognition(JSON.stringify({ items: [], steps: [], uncertainties: ['模糊'] }), 'question', 1));
  assert.throws(() => parseRecognition(JSON.stringify(result), 'answer', 1));
  assert.deepEqual(parseRecognition(JSON.stringify({ items: [], steps: ['a5=4+5*3=19'], uncertainties: ['核对下标'] }), 'answer', 1).steps, ['a5=4+5*3=19']);
  assert.throws(() => parseRecognition(JSON.stringify({ items: [], steps: Array(5).fill('x'.repeat(1900)), uncertainties: [] }), 'answer', 1));
  assert.equal(RecognitionRequest.safeParse({ requestId: 'answer-request', attachmentIds: ['photo'], attemptId: 'round' }).success, false);
});

function uploadFixture(failure?: string) {
  const storage = storageMock(), calls: string[] = [];
  const sandbox = miniappSandbox({ '@/config': { API_BASE: 'http://local' }, '@/utils/request': { request: async (opts: any) => {
    calls.push(opts.path);
    return opts.path === '/api/uploads' ? { uploadId: 'u', objectKey: 'key', url: '/api/uploads/u/file' } : { attachmentId: 'ready' };
  } } }, { uni: { ...storage, getImageInfo: (o: any) => o.success({ type: 'png' }), uploadFile: (o: any) => {
    calls.push('bytes');
    if (failure === 'network') o.fail({});
    else { if (failure === 'session') sandbox.load('@/utils/token').clearToken(); o.success({ statusCode: 200, data: '{"ok":true}' }); }
  } } });
  sandbox.load('@/utils/token').setToken('session');
  return { sandbox, calls };
}
test('真实小程序上传顺序为凭证→文件→complete，完成后重试复用附件；断网/切账号不完成旧附件', async () => {
  const { sandbox, calls } = uploadFixture();
  const image = { id: 'local', path: '/tmp/photo', name: '照片', size: 10 };
  const api = sandbox.load('@/api/uploads');
  assert.equal((await api.uploadAttachments([image], 'question_origin', { conversationId: 'c' }))[0], 'ready');
  assert.deepEqual(calls, ['/api/uploads', 'bytes', '/api/uploads/u/complete']);
  await api.uploadAttachments([image], 'question_origin', { conversationId: 'c' }); assert.equal(calls.length, 3);
  for (const failure of ['network', 'session']) {
    const fixture = uploadFixture(failure);
    await assert.rejects(fixture.sandbox.load('@/api/uploads').uploadAttachments([{ ...image, remote: undefined }], 'question_origin', { conversationId: 'c' }));
    assert.deepEqual(fixture.calls, ['/api/uploads', 'bytes']);
  }
});
