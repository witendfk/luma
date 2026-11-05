# Luma 个人学习助手

高中生创新赛学习助手：提问 → 核对 → 启发引导 → 模型图文教学 → 同类练习 → 作答自评 → 个人错题回看。

**[文档索引](docs/README.md)** · [PRD](docs/spec/PRD.md) · [实施进度](docs/delivery/progress.md) · [下一步任务](docs/delivery/plan.md) · [本地开发](docs/development.md)

## 工程目录

```text
apps/miniapp/        uni-app + Vue 3 + TypeScript 微信小程序
apps/server/         Next.js API、教学 Agent、任务 worker、Prisma
packages/shared/     前后端共享 Zod schema、API 与事件契约
docs/spec/           产品需求与验收标准
docs/design/         交互、系统、Agent、数据接口及技术决策
docs/delivery/       任务、进度、验证与体验版交付
```

开发和推送使用 `feature` 分支，按任务点提交。当前前端 mock 交互已验收，真实教学与体验版业务交付待完成；详情统一维护在进度和验证记录中。

## 快速启动

前置：Node.js ≥ 18.20、pnpm ≥ 9、微信开发者工具。

```bash
pnpm install
pnpm dev:miniapp
```

微信开发者工具导入 `apps/miniapp/dist/dev/mp-weixin`。UI mock、本地 API/数据库/worker 启动、环境开关及故障排查见[本地开发手册](docs/development.md)。真实密钥不提交仓库。
