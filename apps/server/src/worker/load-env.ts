import path from 'node:path';
import { loadEnvConfig } from '@next/env';

/** 与 Next.js 使用相同的 .env 优先级；以服务端目录为基准，不依赖启动位置。 */
export function loadWorkerEnv(serverDir = path.resolve(__dirname, '../..')): void {
  loadEnvConfig(serverDir, process.env.NODE_ENV !== 'production');
}
