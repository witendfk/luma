import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MAX_UPLOAD_BYTES } from '@luma/shared';
import { env } from '../lib/env';
import { invalidFormat, notImplemented, revisionConflict } from '../lib/errors';

const directory = () => path.join(process.cwd(), '.luma', 'uploads');
function filename(key: string): string {
  if (!/^[a-f0-9-]{36}\.(original|vision\.png)$/.test(key)) throw invalidFormat('无效的文件引用');
  return path.join(directory(), key);
}
export function requireLocalUploads(): void {
  if (env().NODE_ENV !== 'development') throw notImplemented('部署环境的私有上传存储（待配置 COS）');
}
export async function validateUploadImage(bytes: Uint8Array, declared: string) {
  if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD_BYTES) throw invalidFormat('单张图片必须在 8 MB 以内');
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    const format = declared === 'jpg' ? 'jpeg' : declared;
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new Error();
    const preview = await image.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return { format, size: bytes.byteLength, preview };
  } catch { throw invalidFormat('图片格式不符、文件损坏或像素过大，请重新选择 JPG、PNG 或 WebP 图片'); }
}
export async function saveUploadBytes(key: string, bytes: Uint8Array): Promise<void> {
  requireLocalUploads();
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  try { await writeFile(filename(key), bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!(await readFile(filename(key))).equals(Buffer.from(bytes))) throw revisionConflict('该附件已上传其他内容，请重新选择图片');
  }
}
export async function readUploadBytes(key: string): Promise<Buffer> {
  requireLocalUploads();
  try { return await readFile(filename(key)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw invalidFormat('图片尚未上传完成，请重新上传');
    throw error;
  }
}
/** Bound buffering before parsing uni.uploadFile's multipart body. */
export async function readUploadForm(req: Request): Promise<Uint8Array> {
  const limit = MAX_UPLOAD_BYTES + 64 * 1024;
  if (!req.headers.get('content-type')?.startsWith('multipart/form-data;')) throw invalidFormat('请使用图片上传请求');
  if (Number(req.headers.get('content-length') ?? 0) > limit) throw invalidFormat('单张图片不能超过 8 MB');
  if (!req.body) throw invalidFormat('未收到图片');
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw invalidFormat('单张图片不能超过 8 MB'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers.get('content-type')! } }).formData(); }
  catch { throw invalidFormat('图片上传内容不完整，请重试'); }
  const file = form.get('file');
  if (!file || typeof file === 'string' || form.getAll('file').length !== 1 || file.size > MAX_UPLOAD_BYTES) throw invalidFormat('请每次上传一张不超过 8 MB 的图片');
  return new Uint8Array(await file.arrayBuffer());
}
