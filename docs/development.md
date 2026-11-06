# Luma 本地开发手册

**职责：说明怎么安装、启动、切换调试模式和排查故障。** 当前完成情况见 [进度](delivery/progress.md)，已验证结果见 [验证记录](delivery/verification.md)。命令均从仓库根目录执行。

前置：Node.js ≥ 18.20、pnpm ≥ 9、微信开发者工具；本地集成另需 Docker/Colima 运行 PostgreSQL。

## 1 两种调试模式

| 模式 | 配置 | 启动范围 | 用途 |
| --- | --- | --- | --- |
| UI mock | 小程序开发环境 `VITE_UI_MOCK=true` | 仅小程序编译 | 页面/交互及本机恢复，不调用真实接口 |
| 本地集成 | `VITE_UI_MOCK=false`，开发身份和模型 mock 按需打开 | API + 数据库 + worker + 小程序 | 页面到正式服务逻辑、数据库及任务验证 |

UI mock 配置在 `apps/miniapp/.env.local`，生产构建不启用。UI mock 中未覆盖操作不回退真实网络；不将演示数据写入正式学习记录。

只看前端时：

```bash
pnpm dev:miniapp
```

文件变化未触发编译时可使用 `CHOKIDAR_USEPOLLING=true pnpm dev:miniapp`。切换开关后重启编译器，等待 `Build complete` 再在微信工具编译。

### 当前服务端开发的联调方式

在微信开发者工具打开已编译小程序，连接 `http://localhost:4000` 的 Next.js API。开发者工具中启用本地“不校验合法域名、TLS 及 HTTPS 证书”，即可联调本地 HTTP；这不要求先部署、真机扫码或上传体验版。

- 关闭 `VITE_UI_MOCK` 才会请求真实业务接口；开发身份 `VITE_DEV_LOGIN` + `LUMA_DEV_FAKE_LOGIN` 可继续使用，得到可校验的应用登录态和本人数据库记录。
- 首个联调任务可使用服务端模型 mock 验证数据归属；接 GPT 时关闭 `LUMA_MOCK_AGENT` 并在服务端配置凭据。不把 UI mock、服务端模型 mock 和开发身份开关混为一项。
- 图片输入先通过模拟器文件选择器使用本机样例，上传到正式存储链路并交真实 GPT 读取；不要求先做手机相机操作。
- 每段完成后在工具 Network/Console 检查业务请求、状态及恢复，服务端查运行/任务日志，数据库核对对象与轮次；这一套就是当前前后端联调。
- 真实微信换码、手机键盘/手势和体验版另在 B07 验证；需要时可以提前单测，不构成开发前置条件。

## 2 工具与导入

- Codex/VS Code：编辑 uni-app、Next.js 和共享契约。
- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)：小程序模拟器、网络/控制台、真机调试和体验版上传。
- Docker/Colima：运行本地 PostgreSQL。
- 不需要 HBuilderX；VS Code 插件不能代替微信开发者工具。

微信开发者工具选择「导入项目」，目录选择编译结果：

```text
/Users/acrdia/Desktop/work_space/学习助手agent分析/luma/apps/miniapp/dist/dev/mp-weixin
```

ARM64 微信开发者工具已安装，项目已导入。已注册个人小程序，真实 AppID 已同步到 `apps/miniapp/src/manifest.json` 的 `mp-weixin.appid` 与 `apps/miniapp/project.config.json`，当前不再是游客模式。真实微信登录仍需配置服务端 AppID/AppSecret，并关闭两端开发身份开关；AppID 已配置不代表真实换码已通过。

开发者工具「详情 → 本地设置」中勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。这只用于本地调试；体验版需 HTTPS 和合法域名。

## 3 本地配置

首次安装依赖、生成 Prisma 客户端并建表：

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm db:generate
pnpm db:up
pnpm --filter @luma/server exec prisma migrate deploy
```

`apps/server/.env` 保留数据库地址等配置，密钥仅放服务端。需要模型 mock 的本地集成时，在未跟踪的 `apps/server/.env.local` 配置：

```dotenv
LUMA_DEV_FAKE_LOGIN=true
LUMA_MOCK_AGENT=true
```

小程序 `apps/miniapp/.env.local` 配置：

```dotenv
VITE_API_BASE=http://localhost:4000
VITE_DEV_LOGIN=true
```

登录按钮统一显示「微信登录」；启用前端开发开关时，页面另显示「开发联调 · 使用本地测试身份」，实际使用 `dev:local-student` 身份；只有服务端 development 模式允许假登录。发布编译不会启用该前端入口，体验版仍需真实微信登录。配置修改后重启相应进程。

## 4 启动与检查

在工程根目录开三个终端：

```bash
# 终端 1：API
pnpm dev:server
```

```bash
# 终端 2：后台任务；watch 模式会跟随代码重启
pnpm --filter @luma/server worker:dev
```

```bash
# 终端 3：小程序开发编译，保持运行以增量更新
VITE_UI_MOCK=false CHOKIDAR_USEPOLLING=true pnpm dev:miniapp
```

浏览器访问 `http://localhost:4000/api/health`，应返回 `ok: true` 和 `db: up`。在开发者工具点击编译；改动源码后由 uni-app 重新生成小程序文件。

上面的终端 3 命令显式使用正式接口，优先于 `.env.local` 中的 UI mock 设置。若编译器未响应源码变更，重启该命令，看到 `Build complete` 后再编译小程序。API 与非 watch worker 的代码变更也要确认已加载；worker 可使用上面的 watch 命令。

需要双题点击样例时，API 开启开发身份后运行 `pnpm seed:demo`。它在 `dev:local-student` 账号下新增标题为「B01 联调 · 两道题独立学习」的记录，每次执行都会新建；不会启动时自动插入，也不代表图片识别。

## 5 自动检查

```bash
pnpm test          # SDK 工具协议、复核布尔值、账号隔离、SSE 等自动回归
pnpm typecheck    # 前后端及共享类型
pnpm test:local   # 服务端、数据库、worker 已启动时，验证实际小程序逻辑到真实 HTTP
pnpm test:runtime # 真库检查取消、超时、中断、段落读取、并发草稿、只读历史、材料重试
pnpm test:migration # 独立 schema 验证实际旧数据迁移，不重置本地数据库
pnpm test:subjects  # 真库检查逐题版本/进度/来源、权限、收藏及导航恢复
```

集成脚本用于当前模拟模型环境；`test:local` 创建带 `dev:smoke-` 前缀的独立测试账号和学习记录，便于检查；`test:runtime`、`test:subjects` 仅清理自己创建的唯一测试账号，`test:migration` 清理自己的隔离 schema。它们不替代微信工具中的点击、公式显示和真机检查。

## 6 真实依赖调试

真实模型联调时替换模型依赖：服务端设置 `OPENAI_API_KEY`、所选 `LUMA_MODEL_ID` 和必要的 `OPENAI_BASE_URL`，关闭 `LUMA_MOCK_AGENT`，重启 API 与 worker。先验证一题三轮引导和工具调用，再测材料生成；不把模拟通过记作真实模型通过。工具协议参考 [OpenAI 官方文档](https://developers.openai.com/api/docs/guides/function-calling)。

手机里的 `localhost` 指手机本身，不能访问电脑。真机与电脑在同一网络时，将 `VITE_API_BASE` 换为电脑局域网地址，例如开发服务启动时打印的 Network 地址，重新编译；实际设备不允许 HTTP 或需要远程访问时，使用 HTTPS 测试域名及小程序后台合法域名配置。最终体验版必须验证电脑关闭后，线上 API、数据库与 worker 仍能正常工作。

## 7 故障排查

- 出现 `module … is not defined` 时，先等 uni-app 输出 `Build complete`，检查报错文件是否真实存在；存在时可清除微信工具的“编译缓存”和“项目文件列表缓存”再重编译。不要直接清全部缓存或学生数据。此处理曾恢复模块异常，但具体触发机制未确认。
- `localhost:4000 … ERR_CONNECTION_REFUSED`：检查 `pnpm dev:server` 是否仍运行。健康接口 `db: down` 时，若使用 Colima，先 `colima start`，再 `pnpm db:up`；保留原数据库卷。
- 页面可显示但生成一直等待：检查现有 `worker:dev` 进程。重启电脑或开发工具不会自动恢复 API、数据库和 worker。
- `report-online.sh.wxgateway.com/SdkReport … ERR_TIMED_OUT` 属于微信工具上报请求；与业务 `/api` 请求分开排查，不能仅根据红字数量判断业务失败。

## 真实图文联调

教学正文与结构化步骤图解由 `LUMA_MODEL_ID` 指定的同一 GPT 生成，通过 schema 和内容复核后发布。该链路不调用独立图像模型，也不依赖 COS。生成任务可查看草稿与复核状态，失败可显式重试。

启动 API、worker 和正式 API 模式的小程序后，在微信工具中打开会话，点击生成图文讲解；完成后进入阅读页。公式通过 `/api/content/render` 排版，段落追问携带讲义和章节引用。

独立图片模型仅为后续学生主动生成总结卡预留，当前不属于讲义调用链；本轮不要求补充其配置。密钥仅放服务端忽略的 `.env.local`，不提交 Git。
