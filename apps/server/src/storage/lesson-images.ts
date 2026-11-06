import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../lib/env';
import { notImplemented } from '../lib/errors';

const directory = () => path.join(process.cwd(), '.luma', 'media');
const validKey = (key: string) => /^[a-f0-9-]{36}\.png$/.test(key);
/** Development-only private persistence. Files are read through an owned artifact; never under public/. */
export async function saveLessonImage(bytes: Uint8Array): Promise<string> {
  if (env().NODE_ENV !== 'development') throw notImplemented('部署环境的教学图片存储（待接 COS）');
  if (bytes.byteLength > 12 * 1024 * 1024) throw new Error('模型图片超过大小上限');
  const png = await sharp(bytes, { limitInputPixels: 12_000_000 }).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const key = `${randomUUID()}.png`;
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory(), key), png, { mode: 0o600, flag: 'wx' });
  return key;
}
export async function readLessonImage(key: string): Promise<Buffer> {
  if (!validKey(key)) throw new Error('图片引用无效');
  return readFile(path.join(directory(), key));
}
