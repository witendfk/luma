import { loadWorkerEnv } from './load-env';

/**
 * 任务执行进程入口（设计文档 §1）。
 * 与 Next.js 服务同仓库、同镜像，独立进程运行：
 *   pnpm --filter @luma/server worker
 * 长生成任务（讲义/题组/配图）离开页面后仍继续，状态写库供查询（§5、§8.3）。
 */
async function main(): Promise<void> {
  // 必须先加载配置，再导入依赖数据库和环境变量的模块。
  loadWorkerEnv();
  const { env } = await import('../lib/env');
  env();
  const { startWorker } = await import('../jobs/runner');
  console.log('[worker] Luma 任务执行进程启动');
  startWorker();
}

main().catch((err) => {
  console.error('[worker] 启动失败', err);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[worker] 收到 ${sig}，退出（未完成任务保留租约，超时后标记中断）`);
    process.exit(0);
  });
}
