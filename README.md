# Luma 学生版 · 工程仓库

Luma 面向高中生创新赛：单题求助 → 启发式引导 → 图文讲解 → 同类练习 → 错题复习的完整学习闭环。本仓库是按 [需求分析](../需求分析.md)、[技术选型](../技术选型.md)、[设计文档](../设计文档.md) 搭建的实现工程。

当前完成情况、验证记录及下一步任务统一见 [实施进度](实施进度.md)。本地启动、微信开发者工具导入及逐环节验收见 [本地联调](docs/本地联调.md)。

| 应用 | 技术栈 | 说明 |
| --- | --- | --- |
| `apps/miniapp` | uni-app + Vue 3 + TS（官方 uni-preset-vue#vite-ts 模板） | 编译目标 mp-weixin |
| `apps/server` | Next.js Route Handlers + Prisma + Vercel AI SDK | 鉴权、接口、教学 Agent 与流式输出 |
| `apps/server` (worker) | tsx 独立进程 | 讲义/题组长生成任务（数据库任务队列） |
| `packages/shared` | Zod | 前后端共享的枚举、SSE 事件与 API 契约 |

## 目录结构

```
luma/
├── apps/
│   ├── server/
│   │   ├── prisma/schema.prisma        # 数据模型（设计文档 §9 全部实体）
│   │   └── src/
│   │       ├── app/api/…               # 全部接口路由（设计文档 §10）
│   │       ├── lib/                    # env / db / auth / http 封装 / SSE 编码
│   │       ├── services/               # 业务服务（路由薄、逻辑在此）
│   │       ├── agent/                  # 执行循环 §4.2 · 上下文 §7.1 · 工具 §6 · 提示词 §5.1
│   │       ├── jobs/                   # 任务领取与讲义/题组任务 §8
│   │       ├── storage/                # COS 受限上传封装
│   │       └── worker/                 # 任务执行进程入口
│   └── miniapp/
│       └── src/
│           ├── pages/                  # 登录/新建对话/对话/阅读/练习/错题本/归档/账号
│           ├── api/  stores/           # 接口客户端与 Pinia 状态
│           └── utils/                  # request + 分块 SSE 适配（enableChunked）
└── packages/shared/
```

## 本地开发

前置：Node ≥ 18.20、pnpm ≥ 9（`corepack enable`）、Docker（仅本地 Postgres）、微信开发者工具。

```bash
pnpm install                 # 安装依赖（workspace 全量）

docker compose up -d postgres
cp apps/server/.env.example apps/server/.env
pnpm db:migrate              # Prisma 迁移（首次建表）

pnpm dev:server              # Next.js 服务，http://localhost:4000
pnpm worker                  # 任务执行进程（讲义/题组生成）

pnpm dev:miniapp             # 编译小程序到 dist/dev/mp-weixin
# 用微信开发者工具「导入项目」选择 apps/miniapp/dist/dev/mp-weixin

pnpm typecheck              # 共享契约、服务端、小程序类型检查
pnpm test                   # 环境、账号隔离、流式通信与任务发布回归
```

### 开发模式便利项

- `LUMA_DEV_FAKE_LOGIN=true` 仅允许在 `NODE_ENV=development` 使用，code 必须为 `dev:<1 至 64 位字母、数字、下划线或短横线>`。开发身份保留 `dev:` 前缀，与真实微信身份隔离；其他环境启用时拒绝运行。
- `LUMA_MOCK_AGENT=true` 时，讲义/题组任务产出占位内容，未配置 GPT 也能联调前端闭环。
- tabBar 图标为脚本生成的占位图，正式图标替换 `apps/miniapp/src/static/tab/`。
- worker 从 `apps/server` 加载与 Next.js 相同优先级的环境文件，支持 `.env`、`.env.local` 及对应环境文件；部署时通过运行环境注入密钥。

Docker 构建从仓库根目录执行 `docker build -f apps/server/Dockerfile -t luma-server .`。根目录 `.dockerignore` 排除密钥、依赖、Git 元数据与本地构建物；容器启动时注入配置，禁止将真实凭据写入镜像。

## 交付前必做（体验版）

1. 真实 AppID 已同步到 `apps/miniapp/src/manifest.json` 与 `project.config.json`；交付前核对账号一致，并完成服务端微信登录及小程序隐私配置。
2. `VITE_API_BASE` 改为线上 HTTPS 域名；小程序后台配置 request/uploadFile/downloadFile 合法域名。
3. 服务端 `LUMA_DEV_FAKE_LOGIN` 必须为 false；微信 AppSecret、GPT 与 COS 密钥只存服务端。
4. 上传体验版 → 后台添加老师为体验成员 → 分享二维码（流程见设计文档 §14）。

## 当前实现与联调边界

文字教学链路已接通小程序 API、状态管理与 SSE：新建 → 首题 → 核对确认 → 引导 → 追问 → 历史恢复；后台题组任务可停靠、发布、恢复并由前端查询状态。Agent 控制工具注册、取消写入保护、有限时限、任务重试快照、草稿并发和历史只读已补充回归。

`pnpm test:local` 使用实际小程序逻辑连接本地 Next.js、PostgreSQL 和 worker；`pnpm test:runtime` 检查真实数据库下的关键状态与并发边界。两者需要服务已启动，目前用于显式模拟模型环境。

登录页已按移动端原型还原，ARM64 微信开发者工具已导入项目，并实际验证未勾选协议时的登录拦截与帮助弹窗。真实 GPT、真实微信登录、其余页面交互与真机尚未验收；首页/对话等原型还原、图文配图、拍照上传识别、正式阅读及练习页面继续按模块接入。当前教学正文校验后整段发送，SSE 状态流保留；构建与逻辑测试通过不代表完整产品交付。

运行记录、接口契约与教学状态机的设计依据见 `../设计文档.md`；验收以 `../需求分析.md` §6 为准。
