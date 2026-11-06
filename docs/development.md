# Luma 本地开发手册

**职责：说明怎么安装、启动、切换调试模式和排查故障。** 当前完成情况见 [进度](delivery/progress.md)，已验证结果见 [验证记录](delivery/verification.md)。命令均从仓库根目录执行。

前置：Node.js ≥ 18.20、pnpm ≥ 9、微信开发者工具；本地集成另需 Docker/Colima 运行 PostgreSQL。

## 1 当前调试方式

小程序始终连接真实业务 API，教学内容由服务端配置的 GPT 生成。已停用交互验收预览模式，环境变量不能重新启用示例工作区，也不会在网络或模型失败时回退到示例回答。

自动化测试可在独立沙箱或 `NODE_ENV=test` 进程使用模型替身；开发和生产服务禁止启用 `LUMA_MOCK_AGENT`。开发身份只解决本地登录，不模拟教学内容。

小程序编译使用 `pnpm dev:miniapp`；文件变化未触发编译时可使用 `CHOKIDAR_USEPOLLING=true pnpm dev:miniapp`。看到 `Build complete` 后再在微信工具编译。

### 当前服务端开发的联调方式

在微信开发者工具打开已编译小程序，连接 `http://localhost:4000` 的 Next.js API。开发者工具中启用本地“不校验合法域名、TLS 及 HTTPS 证书”，即可联调本地 HTTP；这不要求先部署、真机扫码或上传体验版。

- 业务请求始终走真实接口；开发身份 `VITE_DEV_LOGIN` + `LUMA_DEV_FAKE_LOGIN` 可继续使用，得到可校验的应用登录态和本人数据库记录。
- API 与 worker 使用真实 GPT 凭据，`LUMA_MOCK_AGENT=false`；测试替身只用于隔离的自动化测试，不作为页面联调模式。
- 上传视觉接通后可先用模拟器文件选择器验证；具体可用能力查progress，未接通时不得返回预设识别结果。
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

AppID需在`apps/miniapp/src/manifest.json`的`mp-weixin.appid`与`apps/miniapp/project.config.json`保持一致。真实微信登录另需服务端AppID/AppSecret，并关闭两端开发身份开关；填写AppID不代表真实换码通过。

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

`apps/server/.env` 保留数据库地址等配置，密钥仅放服务端。本地真实 GPT 联调在未跟踪的 `apps/server/.env.local` 配置：

```dotenv
LUMA_DEV_FAKE_LOGIN=true
LUMA_MOCK_AGENT=false
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
CHOKIDAR_USEPOLLING=true pnpm dev:miniapp
```

浏览器访问 `http://localhost:4000/api/health`，应返回 `ok: true` 和 `db: up`。在开发者工具点击编译；改动源码后由 uni-app 重新生成小程序文件。

小程序没有预览模式切换开关。若编译器未响应源码变更，重启该命令，看到 `Build complete` 后再编译小程序。API 与非 watch worker 的代码变更也要确认已加载；worker 可使用上面的 watch 命令。

旧演示种子脚本已移除。启动时自动清除旧预览缓存及假凭据，保留真实登录、问题草稿和阅读位置；不自动插入示例记录。

本机旧数据清理脚本为 `apps/server/scripts/cleanup-demo.ts`，仅处理已核实的精确旧会话名单与 `dev:smoke` 测试账号，不按标题猜测真实数据。从 `apps/server` 执行 `node --import tsx scripts/cleanup-demo.ts` 只查看范围；带 `--apply` 才会先保存忽略目录内的关联快照再清理，可重复执行。

## 5 自动检查

```bash
pnpm test          # SDK 工具协议、复核布尔值、账号隔离、SSE 等自动回归
pnpm typecheck    # 前后端及共享类型
pnpm test:local   # 服务端、数据库、worker 已启动时，验证实际小程序逻辑到真实 HTTP
pnpm test:runtime # 真库检查取消、超时、中断、段落读取、并发草稿、只读历史、材料重试
pnpm test:migration # 独立 schema 验证实际旧数据迁移，不重置本地数据库
pnpm test:subjects  # 真库检查逐题版本/进度/来源、权限、收藏及导航恢复
pnpm test:memory    # 真库隔离：记忆生命周期、原文回读、权限与材料快照
pnpm test:reading   # 真库+模型mock：局部修订、记忆回读及20轮连续教学
pnpm test:context   # 独立测试账号：80%阈值摘要、跨轮复用、精确回读及版本隔离
```

使用模型替身的真库脚本在独立测试进程运行，不改变开发 API/worker 的真实模型配置。`test:local` 连接当前真实服务，创建带 `dev:smoke-` 前缀的独立账号并在结束时清理；其他真库测试仅清理自己创建的账号，`test:migration` 清理自己的隔离 schema。它们不替代微信工具中的点击、公式显示和真机检查。

## 6 真实依赖调试

真实模型联调配置：服务端设置 `OPENAI_API_KEY`、所选 `LUMA_MODEL_ID` 和必要的 `OPENAI_BASE_URL`，关闭 `LUMA_MOCK_AGENT`，重启 API 与 worker。先验证一题三轮引导和工具调用，再测材料生成；不把模拟通过记作真实模型通过。工具协议参考 [OpenAI 官方文档](https://developers.openai.com/api/docs/guides/function-calling)。

手机里的 `localhost` 指手机本身，不能访问电脑。真机与电脑在同一网络时，将 `VITE_API_BASE` 换为电脑局域网地址，例如开发服务启动时打印的 Network 地址，重新编译；实际设备不允许 HTTP 或需要远程访问时，使用 HTTPS 测试域名及小程序后台合法域名配置。最终体验版必须验证电脑关闭后，线上 API、数据库与 worker 仍能正常工作。

## 7 故障排查

- 出现 `module … is not defined` 时，先等 uni-app 输出 `Build complete`，检查报错文件是否真实存在；存在时可清除微信工具的“编译缓存”和“项目文件列表缓存”再重编译。不要直接清全部缓存或学生数据。此处理曾恢复模块异常，但具体触发机制未确认。
- `localhost:4000 … ERR_CONNECTION_REFUSED`：检查 `pnpm dev:server` 是否仍运行。健康接口 `db: down` 时，若使用 Colima，先 `colima start`，再 `pnpm db:up`；保留原数据库卷。
- 页面可显示但生成一直等待：检查现有 `worker:dev` 进程。重启电脑或开发工具不会自动恢复 API、数据库和 worker。
- `report-online.sh.wxgateway.com/SdkReport … ERR_TIMED_OUT` 属于微信工具上报请求；与业务 `/api` 请求分开排查，不能仅根据红字数量判断业务失败。

## 真实图文联调

教学正文与结构化步骤图解由 `LUMA_MODEL_ID` 指定的同一 GPT 生成，通过 schema 和内容复核后发布。该链路不调用独立图像模型，也不依赖 COS。生成任务可查看草稿与复核状态，失败可显式重试。

启动 API、worker 和正式 API 模式的小程序后，在微信工具中打开会话，点击生成图文讲解；完成后进入阅读页。公式通过 `/api/content/render` 排版，段落追问携带讲义和章节引用。

独立图片模型用于学生主动生成总结卡，不属于讲义调用链；仅调试正文和教学图示时不需要该配置。密钥仅放服务端忽略的 `.env.local`，不提交 Git。

上下文预算：普通请求 `CONTEXT_INPUT_TOKENS=300000`，长材料 `LONG_TASK_CONTEXT_INPUT_TOKENS=1000000`；`MAX_RUN_TOKENS=1000000` 单独限制一次运行的累计用量。配置不代表网关容量已实测。输入按GPT编码估算；普通窗口内另预留输出，`CONTEXT_COMPACT_RATIO=0.8`触发滚动摘要，`CONTEXT_SUMMARY_TOKENS=4096`限制摘要大小；不再固定只取12条或直接丢弃旧历史。更改环境变量后重启 API 和 worker。

真实局部修订检查会使用已配置 GPT 并写入指定开发会话，按需手动运行 `pnpm --filter @luma/server test:reading:live <conversationId>`；`--verify-latest` 只核验最新局部修订任务，不额外调用模型。

`pnpm --filter @luma/server test:context --live` 使用已配置GPT在独立测试账号验证真实摘要和续接；脚本用18k测试窗口触发80%阈值，不修改环境文件或已有学习记录，结束仅清理自己的测试账号。普通 `test:context` 为真库+模型mock，不冒充真实摘要质量。

调用记录可查 `context_summary` 用途和 `cachedInputTokens`；该数是输入token子集，不减掉窗口用量。公式/图形缓存仅进程内，重启冷启动，不缓存任意教学回复或学生资料。

教学记忆真实GPT抽验从 `apps/server` 执行 `node --import tsx scripts/memory-live-check.ts`：创建独立账号，故意让摘要漏掉讲法与方法，核验记忆提取、search→read及后续教学，产生真实模型用量。结束自动清理自己的数据，脱敏报告保存在忽略目录 `.luma/checks/`；不向用户学习列表种入示例。

## 8 本地教学 Skill

`apps/server/src/agent/skills/luma-tutor/SKILL.md`是项目运行资源；`loadTutoringPolicy`读取“教学边界”起的正文，主对话通过`assembleSystem`、后台通过`loadTeachingTaskPrompt`将实际内容发给GPT。参考原文`references/sigma/`不自动加载，学生端不访问GitHub或临时目录。

修改Skill后开启下一轮请求会重新读取内容；修改TypeScript加载代码时确认API/worker已热更新，非watch进程需重启。运行方式仍使用本文已有pnpm脚本、以apps/server为服务工作目录；资源读取失败应报错，不能静默当作已有教学策略。定向请求装配检查：

```bash
pnpm --filter @luma/server exec node --import tsx --test tests/tutoring.test.ts
```

该检查使用SDK模型替身捕获实际输入，不调用真实GPT，不证明教学效果；真实行为验收归T01/T04。当前开发不需要为此做生产构建或部署。
