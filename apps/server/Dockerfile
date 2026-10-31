# Luma 服务端镜像：Next.js 服务与任务执行进程共用，命令不同。
# 首期脚手架保持单阶段构建；第三周部署时再按需拆分多阶段与体积优化。
FROM node:20-alpine

RUN corepack enable
WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm --filter @luma/server prisma:generate \
  && pnpm build:server

EXPOSE 4000

# 服务：pnpm --filter @luma/server start
# 任务进程（另起容器）：pnpm --filter @luma/server worker
CMD ["pnpm", "--filter", "@luma/server", "start"]
