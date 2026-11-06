# Luma 数据与接口设计

依据：[系统设计](architecture.md)、[交互设计](interaction.md)、[Agent 设计](agent.md)。整理日期：2026-11-05。

**职责：定义实体归属、版本与唯一性、API、事件及鉴权边界。** 路由表以既有接口为基线；明确标为目标补充的内容需后续实施，不能当成当前已提供的接口。当前源契约位于 `packages/shared`，数据模型位于 `apps/server/prisma/schema.prisma`。

## 1 数据结构

B01 已实施以下多对象结构及增量迁移；尚未接入的真实模型/上传及页面能力见实施计划，不能仅凭路由存在判为完成。

| 实体 | 关键字段及关系 |
| --- | --- |
| `User` | 账号标识、微信身份关联、昵称、头像 |
| `AuthSession` | 用户、会话凭据摘要、过期时间、撤销时间 |
| `Conversation` | 用户、标题、归档时间、最近学习时间、当前对象、逐项学习意愿 |
| `LearningSubject` | 会话、稳定对象标识和排序；类型、内容及确认状态在对象版本中 |
| `SubjectRevision` | 会话、对象标识、版本号、题目或知识点类型、内容、标签、小问、确认时间、原图引用 |
| `ProcessTranscript` | 会话、作答图片、转写步骤、学生修正、逐步确认状态及来源版本 |
| `Message` | 会话、对象标识、角色、结构化内容、来源版本、请求标识、完成状态、时间 |
| `LearningProgress` | 会话、对象标识、教学阶段、并发版本、输入草稿、恢复目的地、当前来源版本、当前讲义及段落、练习轮次与追问题目 |
| `Artifact` | 会话、来源版本、讲义或题组类型、材料版本、结构化内容、发布状态 |
| `Exercise` | 题组、题序、题干、考点、难度、目的、参考答案与解析 |
| `PracticeAttempt` | 题组、用户、所选题目、阶段、当前题号、提交与完成时间 |
| `PracticeAnswer` | 轮次、题目、文字草稿、照片、暂不会、自评、提示及解析查看记录 |
| `CollectionEntry` | 用户、会话、对象标识、笔记、待复习或已复习、是否收藏 |
| `Attachment` | 用户、对象键、用途、格式、大小、原图与预览关系 |
| `AgentRun` | 会话、请求标识、来源版本、目标与任务进度、等待及恢复状态、提示词版本、分项计数、耗时及消耗 |
| `ToolExecution` | 运行、决策与工具调用标识、批次顺序、执行状态、幂等键、参数摘要、结果引用、错误及耗时 |
| `GenerationJob` | 运行、任务类型、来源版本、状态、当前步骤、结果引用、幂等标识 |

### 数据约束

- 学习对象内版本号唯一；题目更新创建新版本，旧练习继续引用旧版本。
- 用户与学习对象的收藏关系唯一；再次保存恢复或更新原记录。
- 轮次与题目的作答记录唯一；草稿更新使用该组合定位。
- 消息请求标识唯一，任务幂等标识唯一，避免重试重复新增。
- 作答快照、图片关联和自评保留在原轮次，重做创建新轮次。
- 题组与单题发布后不修改题目和参考答案；需要修订时生成新材料版本。
- 显示材料入口时区分未生成、生成中、已完成及失败，收藏不触发伪造的完成状态。

### 1.1 运行记录字段约束

以下编排字段已纳入既有模型与迁移设计，后续接入需保持这些约束；代码存在不代表真实 GPT 验收通过：

| 实体 | 补充内容 |
| --- | --- |
| `AgentRun` | 会话与请求标识的唯一约束、输入摘要、截止时间、重试来源及用户消息引用；`TaskFrame`、等待任务与工具调用引用、恢复所需协议片段、执行领取/租约字段；权限及焦点快照、提示词版本；决策、工具往返、工具执行及各类模型请求分别计数，记录累计用量 |
| `GenerationJob` | 固定输入 `payload`、任务调用计数与消耗、总截止时间、草稿检查点、重试来源；当前来源材料和权限快照仍不完整；目标要求见 §5，worker 不从可变的“当前页面”重建局部修订输入 |
| `ToolExecution` | `decisionId`、原生 `toolCallId`、状态、幂等键及任务引用；支持批次待执行队列与每个调用唯一结果 |
| `Message` | 保留当前结构化内容和完成状态；用户消息与助理消息分别关联运行，重试不重复创建用户消息 |

前台任务创建、消息与终态更新遵守同会话短事务约定。学习对象修改与后台发布共用会话记录锁，保证版本检查和更新不交错。后台任务完成不自动覆盖学生后来选中的练习或讲义焦点。

## 2 接口与事件

接口统一位于 `/api` 下；除登录和不含用户数据的健康检查外，业务接口均校验应用登录态。会新建运行、任务或练习轮次的命令以 `requestId` 去重；草稿更新还需版本校验。当前不是所有更新接口都实现了请求去重，尤其练习开始/重做待 B05 补齐，不能将统一目标当成已有保证。

| 接口 | 用途 |
| --- | --- |
| `POST /auth/wechat/login` | 服务端校验小程序登录 code，签发应用会话凭据 |
| `GET /auth/me`、`POST /auth/logout` | 当前账号、退出 |
| `POST /uploads`、`POST /uploads/:id/complete` | 获取受限上传地址，确认文件有效并可引用 |
| `GET /conversations`、`POST /conversations` | 最近或归档列表、创建会话 |
| `PUT /conversations/:id`（兼容 PATCH） | 修改名称、归档、恢复 |
| `GET /conversations/:id` | 当前题目、进度和材料概览 |
| `GET /conversations/:id/messages` | 分页读取消息 |
| `POST /conversations/:id/turns` | 消息或学习操作，返回流式事件 |
| `POST /conversations/:id/subjects` | 创建独立对象；旧 action=update/confirm 暂保留给 UI mock 适配 |
| `PUT /conversations/:id/focus` | 切换 subjectId，可保存 learnAll；只恢复不生成 |
| `POST /conversations/:id/subjects/:subjectId/revisions` | expectedRevision 校验后新增对象版本 |
| `POST /conversations/:id/subjects/:subjectId/confirm` | 确认指定版本；重复确认幂等 |
| `PUT /conversations/:id/subjects/:subjectId/progress` | 保存 destination/draft/artifact/section/attempt/exercise；校验 expectedRevision + expectedVersion |
| `GET /artifacts/:id/attempts` | 本人该题组的历史轮次，不创建轮次、不揭示答案 |
| `POST /conversations/:id/process-transcripts/:transcriptId/confirm` | 确认或修正解题过程步骤 |
| `GET /artifacts/:id` | 按权限与当前阶段返回讲义或题组 |
| `GET /jobs/:id`、`POST /jobs/:id/retry` | 任务状态、重试 |
| `POST /runs/:id/cancel` | 取消本轮及其关联未完成任务 |
| `GET /runs/:id` | 查询运行状态与目标进度，用于断线后恢复 |
| `POST /practice-attempts` | 开始或重做练习 |
| `GET /practice-attempts/:id` | 读取题目、进度及本人作答 |
| `PUT /practice-attempts/:id/answers/:exerciseId` | 保存草稿、图片、提示记录或自评 |
| `POST /practice-attempts/:id/submit` | 提交作答，进入自评 |
| `POST /practice-attempts/:id/complete` | 校验自评齐全并完成本轮 |
| `GET /collections`、`GET/PUT /collections/:subjectId` | 对象级查询/保存；支持 view=all/question/knowledge、keyword、reviewStatus |
| `DELETE /collections/:subjectId` | 软取消收藏，保留笔记、复习状态、材料和练习 |
| `POST /feedback` | 记录模型内容错误反馈 |

对话在微信目标端通过 wx.request 的 enableChunked 与 onChunkReceived 接收 `text/event-stream`，在 uni-app 平台适配层实现增量 UTF-8 解码和事件拼接，处理跨块字符及半条事件。事件类型为 `run.started`、`text.delta`、`tool.started`、`tool.finished`、`artifact.updated`、`run.completed`、`run.failed`、`run.cancelled`。服务端代理关闭响应缓冲；真机需验证首段、停止及断线恢复。只返回操作说明和结果，不返回模型内部推理。

结构性变更携带 `expectedRevision`，来源已更新时返回冲突并刷新。草稿按题目防抖保存，显示保存中、已保存及失败；请求携带递增版本，服务端拒绝旧草稿覆盖新草稿。同一请求重试复用 `requestId`，学生发起新操作生成新的标识。

断线后通过会话和任务接口重新拉取状态，不重放原请求。材料任务在页面可见时每 2 秒查询一次，完成、失败或离开后停止轮询；返回时立即查询。

共享事件契约包括：`subject.updated` 返回已保存的题目版本及核对状态；`job.created` 返回可查询的任务引用；`run.waiting` 区分等待学生与等待材料，前者结束自动执行，后者仅结束当前流并保留后续决策；运行状态查询返回目标进度与新增消息。运行失败显式重试携带新的 `requestId` 及 `retryOfRunId`。这些事件已在共享契约基线中定义，subject.updated/artifact.updated 已包含稳定 subjectId 和 subjectRevisionId；真实正文流已在 B02 接入，断流恢复仍需按场景补验。显式重试复用原用户消息和经过验证的输入；修改内容应发送新消息，不伪装成重试。重复请求的已完成结果可按存储内容重放，运行中仅返回已有运行引用，不再启动一次模型调用。

错误返回 `code`、用户可读的 `message`、`retryable` 和请求引用。重点区分未登录、无权限、版本已更新、会话忙碌、格式错误、超限、模型不可用及生成中断。

## 3 登录与数据边界

小程序通过 uni.login 获取微信 code，提交服务端调用微信登录校验接口；服务端按本 AppID 下的 openid 关联用户，签发高随机度、带有效期且可撤销的应用会话凭据。数据库保存凭据摘要，客户端使用受控本地存储并在 HTTPS 请求头中携带凭据，不放入 URL；过期后重新进行微信登录。微信 AppSecret 和 session_key 不下发。前端仅展示应用获取的资料，不假定微信自动返回昵称头像。

应用只提供个人学习功能。微信平台的体验版进入资格与应用登录态分别校验；服务端始终按本人归属校验学习数据，撤销应用访问时同步撤销会话。

- 请求中传入的所有会话、材料、图片和练习标识均验证本人归属及对应关系。
- 上传检查格式、真实文件类型、8 MB 限制及可解码性，文件引用使用私有对象访问方式。
- 模型密钥与存储凭据仅在服务端环境变量中配置；小程序不提供配置入口。
- Markdown 禁用原始 HTML，链接和图片来源受控，避免直接执行模型内容。
- 所有受保护操作校验有效的应用凭据和数据归属，不以客户端传入的用户标识、AppID 或请求来源作为鉴权依据。
- 退出使登录态失效，清除页面内存与该账号本地草稿缓存；已同步服务端的数据保留。
- 服务端存储只返回必要字段；运行日志记录引用、错误和消耗，避免复制原图、密钥和完整学生内容。

## 4 B01 已实施约定与后续边界

- 会话详情返回 `subjects[]`、当前 `subject`（版本）、`progress`、当前对象材料和 `activeRun`。`SubjectView.id` 是版本 ID，`subjectId` 是稳定对象 ID；禁止混用。
- 消息按 `subjectId` 筛选，省略时取当前焦点；发送带 `subjectId` 与 `expectedRevision`。与当前焦点不符的迟到输入被拒绝。
- 修改题干只增加当前对象版本并清除该对象的材料定位；旧材料和轮次继续保留。后台发布及运行保护按来源对象内的最新版本检查，不按整段会话最大版本检查。
- 学习进度并发版本独立于题干版本。材料/章节/轮次/题号必须属于该版本；损坏或过期定位在读取时回退对话入口，不以 GET 改写历史。
- `PracticeAttempt` 共享 DTO 使用 `exercises[].myAnswer`，无顶层 answers；历史接口已提供。开始/重做的 requestId 和 redoOfAttemptId 尚待 B05。
- 取消收藏记录 `removedAt`，重新收藏复用原行。列表只展示未取消项，详情可读回保留的笔记。
- 归档/恢复/重命名不更新学习时间；真实新消息在创建运行事务内取消归档，前端不预先发恢复请求。
- 迁移 `20261105090000_learning_subjects` 为每个旧会话建立首对象，保留所有旧字段和既有材料/练习；隔离 schema 的旧结构+旧数据迁移验证已通过。本地开发库已应用，其他环境需执行 migrate deploy，不使用 reset。
- UI mock 保留前端示例行为；正式小程序对话已接焦点与草稿接口。阅读/练习页面定位接线、首页精准续学、错题本完整正式数据接入依 B04～B06 实施；图片识别建多对象依 B03。

## 5 对象级教学上下文（目标契约，待实施）

### 5.1 数据与来源

最小实现复用 PostgreSQL，在对象版本下增加一份受版本控制的 `TeachingState`，与页面恢复用的 `LearningProgress` 分开；不新增向量库或跨会话画像。以下为逻辑字段，不表示共享 schema 或数据库已实现。

| 字段 | 约束 |
| --- | --- |
| `subjectId / subjectRevisionId / version` | 稳定对象、内容版本及状态并发版本；来源修订后不直接继承旧事实 |
| `mode` | question / concept / correction；程序根据对象、学生意图及已确认步骤决定可用教学方式 |
| `difficulty / methods / openQuestions` | 当前卡点、已讲方法、未解决问题；条目限量、可更新或撤销，来源失效时不装配 |
| `evidenceRefs` | 每条教学记录必须引用本人且属于该对象版本的 message、artifact+version+section 或已确认过程；标明 student_statement / observed_action / model_inference |
| `understanding` | 学生明确表示理解的事件及其消息、对象版本、可选材料版本引用；仅表示自述，不代表掌握、不自动生图 |
| `updatedAt` | 服务端更新时间；更新使用 expectedVersion，重复事件引用去重 |

学生自述与系统推测分开。优先从确定事件更新，例如明确卡点、讲义发布、确认理解及追问；需要语义提炼时复用本轮模型结构化结果并验证来源，不为每轮强制增加摘要调用。记忆只帮助教学，不能授予答案访问权限。首期按对象版本保留当前进展即可，不建设全历史自动压缩服务。

### 5.2 按需读取与修订

- `readLearningContext` 增加明确的材料引用和旧消息 cursor/有限条数读取；默认只读当前对象版本。读取旧版本必须显式指定，并标记历史，不能作为当前题干事实。现有消息分支须补版本、焦点及完成状态过滤。
- 章节追问输入固定 `subjectId / subjectRevisionId / artifactId / artifactVersion / sectionId`；练习追问另带 attemptId/exerciseId。服务端验证归属和对应关系，再按权限投影。
- 页面返回位置仍写 `LearningProgress`，与教学理解记录分别维护；结束追问清除本轮局部焦点，不删除教学记录。
- 局部重讲任务固定上述来源及原材料快照、原段落、学生要求和创建时权限。worker 不重新读取当前焦点作为输入；发布前复验来源版本及权限。只有指定段落变更，其余段落沿用原内容和稳定标识；产生新材料版本，不覆盖旧成果。
- 切题加载该对象自己的状态；题干修订使旧语义记录不参与当前装配，旧版本仍可历史回读。切换练习轮次不继承旧解析授权。完成/取消/修订的迟到更新按并发版本拒绝。

## 6 上传识别（目标契约，B03 开工约束）

上传请求声明 purpose（题目、课堂材料、解题过程、练习作答）及对应会话/对象/轮次引用；全部验证本人归属。签发受限私有对象键，附件先为 pending；complete 按附件 ID 幂等验证真实格式、可解码性及不超过 8 MB 后变为 ready，失败不可引用。临时本机路径不作为正式来源。

识别工具只收 ready 的 attachmentId，不接受任意网络地址；服务端受控读取图片交给 GPT。保存附件引用及结构化识别结果：独立题列表、共享题干小问、公式/图形条件、不确定片段。独立题各建学习对象，核对后才能据其解题；解题过程单独确认步骤，不默认为学生已认可。以请求及附件/来源版本去重，修订后拒绝旧识别结果覆盖当前内容。作答照片仅对所属轮次和题目可见。

## 7 总结图解卡（目标契约，B04-S）

- 新增独立 `summary_card` 成果/任务及显式生成操作，不能复用 lesson 当作已完成实现。
- 请求携带 requestId、subjectId、subjectRevisionId、明确理解确认消息，以及可选 artifactId/artifactVersion；确认和来源均需本人且相互匹配。没有讲义时可基于本对象已完成的教学消息生成，不扩大到整个聊天历史。
- 创建时固定已讲内容、选中材料和确认事件快照；去重键基于账号、对象版本及教学来源快照。重复点击返回同一任务/成果；主动重新生成与失败重试区分，保留旧成果。
- 独立图像生成调用计入任务预算，复核后发布私有静态图片，保存正文总结、图片引用、来源及版本。任务状态/重试沿用 jobs 契约，读取沿用 artifacts 归属校验。
- 确认理解本身不启动任务；生成失败不损坏讲义或对话，学生可跳过。缩略图、放大及从收藏详情回看复用现有容器，不另设后台菜单。
