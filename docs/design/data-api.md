# Luma 数据与接口设计

依据：[系统设计](architecture.md)、[交互设计](interaction.md)、[Agent 设计](agent.md)。整理日期：2026-11-06。

**职责：定义实体归属、版本与唯一性、API、事件及鉴权边界。** 路由表以既有接口为基线；明确标为目标补充的内容需后续实施，不能当成当前已提供的接口。当前源契约位于 `packages/shared`，数据模型位于 `apps/server/prisma/schema.prisma`。

## 1 数据结构

本节定义多对象结构。字段以Prisma/shared为实现依据；当前接入状态只看[进度](../delivery/progress.md)，路由或表存在不等于页面及真实依赖已可用。

| 实体 | 关键字段及关系 |
| --- | --- |
| `User` | 账号标识、微信身份关联、昵称、头像 |
| `AuthSession` | 用户、会话凭据摘要、过期时间、撤销时间 |
| `Conversation` | 用户、标题、归档时间、最近学习时间、当前对象、逐项学习意愿 |
| `LearningSubject` | 会话、稳定对象标识和排序；类型、内容及确认状态在对象版本中 |
| `SubjectRevision` | 会话、对象标识、版本号、题目或知识点类型、内容、标签、小问、确认时间、原图引用及只读兼容的旧教学进展JSON |
| `TeachingMemory` | 对象版本、作用范围、来源证据、候选/有效/解决/替代/冲突状态与并发版本；见§5.3 |
| `ContextSummary` | 对象版本、焦点/权限哈希、摘要版本、notes、覆盖末消息ID/时间、累计覆盖数 |
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
- 练习追问按用户、会话、来源版本、轮次及焦点题投影：题干、本人草稿、暂不会、提示次数、自评、解析查看时间及轮次提交/完成时间。`assessmentSource=student_self_report`明确自评来源，不等于判分或掌握度；缺失记录保留缺失。看过解析不自动授予当前答案权限。作答中经授权加载解析时记录并保留首次暴露时间，本次上下文直接使用已保存记录；其他题作答与答案不加载。
- 题组与单题发布后不修改题目和参考答案；需要修订时生成新材料版本。
- 显示材料入口时区分未生成、生成中、已完成及失败，收藏不触发伪造的完成状态。

### 1.1 运行记录字段约束

以下编排字段已纳入既有模型与迁移设计，后续接入需保持这些约束；代码存在不代表真实 GPT 验收通过：

| 实体 | 补充内容 |
| --- | --- |
| `AgentRun` | 会话与请求标识的唯一约束、输入摘要、截止时间、重试来源及用户消息引用；`TaskFrame`、等待任务与工具调用引用、恢复所需协议片段、执行领取/租约字段；权限及焦点快照、提示词版本；决策、工具往返、工具执行及各类模型请求分别计数，记录累计用量 |
| `GenerationJob` | 固定输入 `payload`、任务调用计数与消耗、总截止时间、草稿检查点、重试来源；B04-R 已固定局部讲义来源和权限快照；约束见 §5，worker 不从可变的“当前页面”重建局部修订输入 |
| `ToolExecution` | `decisionId`、原生 `toolCallId`、状态、幂等键及任务引用；支持批次待执行队列与每个调用唯一结果 |
| `Message` | 保留当前结构化内容和完成状态；用户消息与助理消息分别关联运行，重试不重复创建用户消息 |

前台任务创建、消息与终态更新遵守同会话短事务约定。学习对象修改与后台发布共用会话记录锁，保证版本检查和更新不交错。后台任务完成不自动覆盖学生后来选中的练习或讲义焦点。

## 2 接口与事件

接口统一位于 `/api` 下；除登录和不含用户数据的健康检查外，业务接口均校验应用登录态。新运行和任务通过请求标识去重，草稿更新需版本校验。练习普通开始采用题组行锁下的ensure语义，复用最近轮次；显式重做未来需独立命令和请求标识，不共用普通开始命令。

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
| `POST /conversations/:id/subjects` | 创建独立对象；旧 action=update/confirm 仅为历史契约兼容 |
| `PUT /conversations/:id/focus` | 切换 subjectId，可保存 learnAll；只恢复不生成 |
| `POST /conversations/:id/subjects/:subjectId/revisions` | expectedRevision 校验后新增对象版本 |
| `POST /conversations/:id/subjects/:subjectId/confirm` | 确认指定版本；重复确认幂等 |
| `PUT /conversations/:id/subjects/:subjectId/progress` | 保存 destination/draft/artifact/section/attempt/exercise；校验 expectedRevision + expectedVersion |
| `GET /artifacts/:id/attempts` | 本人该题组的历史轮次，不创建轮次、不揭示答案 |
| `POST /conversations/:id/process-transcripts/:transcriptId/confirm` | 确认或修正解题过程步骤 |
| `GET /artifacts/:id` | 按权限与当前阶段返回讲义或题组 |
| `GET /artifacts/:id/practice?version=N` | 只读查找该讲义版本的默认整份配套题组，返回none/queued/running/succeeded/failed及对应jobId/artifactId；不生成、不返回答案 |
| `GET /jobs/:id`、`POST /jobs/:id/retry` | 任务状态、重试 |
| `POST /runs/:id/cancel` | 取消本轮及其关联未完成任务 |
| `GET /runs/:id` | 查询运行状态与目标进度，用于断线后恢复 |
| `POST /practice-attempts` | 首次开始或继续最近轮次；重复/并发请求不新建轮次 |
| `GET /practice-attempts/:id` | 读取题目、进度及本人作答 |
| `PUT /practice-attempts/:id` | 保存当前exerciseId；已完成轮次只读 |
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

### 2.1 材料任务卡投影

`GET /conversations/:id`返回`materialTasks: MaterialTaskView[]`，包含稳定卡ID、当前jobId、原runId/userMessageId、subjectRevisionId、type、status、artifactId、title、summary、historical及安全错误信息。前端优先绑定该运行的助理回复，否则绑定原学生消息；无匹配消息时不挂到其他轮次。重试链归并到原卡，保留原轮次归属并更新当前任务引用。

未发布时不投影任务payload中的题干/目标或草稿正文；生成卡仅展示动画和生成提示。已发布才从正式成果提取标题/章节摘要，题组不投影题干或答案。历史版本明确标记；成果缺失不能冒充成功。`step`兼容字段不作为学生端卡片内部阶段展示。

`TaskFrame.goals`支持`source: student_request | teaching_decision`、自主讲义的简短`reason`以及`reuseArtifactId`。缺省来源按学生请求兼容；自主练习不允许。上下文提供同版本已发布且当前权限可读的最多8份讲义标题/章节目录。复用仍须执行器核验会话、版本、发布状态、解析权限与作答焦点，不因模型引用ID直接放行；局部改写不走整份复用。复用不创建生成任务，仍投影本轮的成果入口。

### 2.2 教学回复展示契约

新模型 `respond` 返回 `content: [{type: "paragraph" | "heading" | "formula", text: string}]`，由共享 `TeachingReply` 校验。独立公式块使用不带定界符的LaTeX，正文可含行内公式；模型不能指定展示HTML。消息保存 `content.reply`，原 `blocks[type=text]` 为服务端生成的兼容文本投影，供上下文和检索使用，不要求迁移历史消息。

`POST /content/render` 接收 `{text, content?}`；有合法content时优先按块渲染，返回 `{blocks, failed}` 受控节点/公式图片。旧消息继续解析Markdown，包括加粗内嵌公式。流式未闭合公式不显示源码；排版失败显示明确占位并可单独重试排版，不重发教学请求。

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

## 4 多对象兼容与迁移约束

- 会话详情返回 `subjects[]`、当前 `subject`（版本）、`progress`、当前对象材料和 `activeRun`。`SubjectView.id` 是版本 ID，`subjectId` 是稳定对象 ID；禁止混用。
- 消息按 `subjectId` 筛选，省略时取当前焦点；发送带 `subjectId` 与 `expectedRevision`。与当前焦点不符的迟到输入被拒绝。
- 修改题干只增加当前对象版本并清除该对象的材料定位；旧材料和轮次继续保留。后台发布及运行保护按来源对象内的最新版本检查，不按整段会话最大版本检查。
- 学习进度并发版本独立于题干版本。材料/章节/轮次/题号必须属于该版本；损坏或过期定位在读取时回退对话入口，不以 GET 改写历史。
- `PracticeAttempt`共享DTO包含conversationId及`exercises[].myAnswer`，无顶层answers；历史查询接口已提供。普通开始锁定题组并复用最近轮次，不通过重复POST实现重做；显式重做的requestId和redoOfAttemptId另行实现。同版本同内容的草稿重试幂等，不同内容的旧版本拒绝。submit/complete重复调用返回现有结果，不重设完成时间；提交后禁止修改原作答，完成后整轮只读。
- 配套练习的生成与作答轮次分开去重。讲义入口提交`generate_practice + practiceMode=ensure`及准确artifactId/artifactVersion，不接受章节/练习焦点。服务端在会话锁下按`practiceSource={artifactId,artifactVersion,subjectRevisionId,scope:whole_lesson,count:2,difficulty:basic}`查找或创建；复用成功/生成中任务，失败不自动付费重试，停止或失效任务不复用。普通自由输入未带ensure时可请求新一组，不覆盖原题。任务保存来源讲义内容快照供生成/复核，发布再核对来源版本。旧任务只通过已有evidence.focus中的准确整份讲义引用和相同训练参数关联，无法确认来源时不猜测。
- 取消收藏记录 `removedAt`，重新收藏复用原行。列表只展示未取消项，详情可读回保留的笔记。
- 归档/恢复/重命名不更新学习时间；真实新消息在创建运行事务内取消归档，前端不预先发恢复请求。
- 迁移`20261105090000_learning_subjects`为每个旧会话建立首对象，保留旧字段和既有材料/练习；其他环境执行增量migrate deploy，不使用reset。执行证据只在verification维护。
- 小程序正式路径只调用真实服务，不因接口未接入回退示例数据；各页面完成状态见progress。

## 5 对象级教学上下文（B04-R）

### 5.1 数据与来源

`SubjectRevision.teachingState`是只读兼容JSON，对应迁移`20261106090000_teaching_state`。旧结构为version/notes，notes包含difficulty、method、openQuestion、来源消息/材料/焦点及containsSolution；旧12条限制只用于解释历史数据，**不再作为新记忆的写入或保留策略**。旧JSON不再随回复更新，不按旧resolved字段清空。新记录统一走§5.3的TeachingMemory及`planTurn.memories`/`respond.teaching.operations`。

页面位置`LearningProgress`、语义记忆`TeachingMemory`和过程摘要`ContextSummary`各自负责不同数据，不能相互覆盖。

滚动摘要独立存 `ContextSummary`：`subjectRevisionId + scopeKey` 唯一，scopeKey包含材料版本/段落、练习轮次/题目及本轮解析权限；body.notes 保存 kind/text/refs/可选quote。条件、计算和要求必须逐字引用，原消息ID必须属于输入或已有摘要。`throughMessageId / throughCreatedAt / coveredMessages` 固定已覆盖边界，`version` 用于并发保存；更新与取消共用会话锁及活动运行校验。ContextSummary保留最新检查点；每个新摘要版本及覆盖清单另写内部ToolExecution审计，同事务提交，不删除原文。迁移 `20261106110000_context_summary` 已应用本地库；本批复用现有JSON和执行记录，无新增迁移。

新的运行不预先按token裁掉历史；驱动器按覆盖游标加载后续原文，必要时将旧摘要与新增旧轮次交GPT合并，保存成功再继续。失败保留原文与已提交检查点；摘要不通过校验不得推进覆盖游标。旧权限、其他焦点和旧题干版本的摘要均不装配。

`teachingMode` 由 policy 按当前对象和确认过程产生，不存成学生长期属性。理解确认事件及其专用去重契约仍归 B04-S，尚未实现；不能以现有 notes 冒充已完成。状态内部更新使用会话锁/活动运行检查，不新增客户端任意写入接口。

### 5.2 按需读取与修订

- `readLearningContext` 已支持当前对象版本内的材料引用和消息 cursor/有限条数或messageIds精确读取，过滤归属、版本、完成状态、焦点及解析权限；不支持直接回读旧题干版本。旧版本跨版本工具读取仍后置，不冒充当前事实。
- 章节追问输入固定 `subjectId / subjectRevisionId / artifactId / artifactVersion / sectionId`；练习追问另带 attemptId/exerciseId。服务端验证归属和对应关系，再按权限投影。
- 页面返回位置仍写 `LearningProgress`，与教学理解记录分别维护；结束追问清除本轮局部焦点，不删除教学记录。
- 局部重讲任务固定上述来源及原材料快照、原段落、学生要求和创建时权限。worker 不重新读取当前焦点作为输入；发布前复验来源版本及权限。只有指定段落变更，其余段落沿用原内容和稳定标识；产生新材料版本，不覆盖旧成果。
- 切题加载该对象自己的状态；题干修订使旧语义记录不参与当前装配，旧数据仍保存在数据库，当前工具不跨题干版本回读。切换练习轮次不继承旧解析授权。完成/取消/修订的迟到更新按并发版本拒绝。

### 5.3 教学记忆与回读契约

§5.1旧JSON保留兼容历史，新依据从TeachingMemory读取。迁移`20261106160000_teaching_memory`保留旧JSON和消息，旧条目为candidate，不补造原话或核验结论；不提供客户端任意写记忆接口。下文定义覆盖清单和结果回读协议；实现与验收状态只在progress维护。

| TeachingMemory字段 | 约束 |
| --- | --- |
| id / subjectRevisionId / scope | 对象版本内的稳定条目标识；scope区分对象通用、材料段落、练习轮次/题目；归属从会话关联验证，模型不可自选账号 |
| kind / text | constraint、request、difficulty、method、attempt、open_question；字段是通用学习语义，不固定数学考点 |
| sourceKind / evidence | student_statement、model_inference、reviewed_material或verified_tool；原消息/材料/执行结果ID、版本及必要逐字片段。来源存在不等于结论正确 |
| status / supersedesId | candidate、active、resolved、superseded、conflicted；替代对象必须同作用范围且带更正来源；模糊冲突不自动覆盖 |
| containsSolution / verificationRef | 带答案证据的记录须经过现有权限投影；验证类别由受控程序依据真实来源赋予，模型不得自报已核验 |
| version / createdAt / updatedAt | 受保护事务并发更新；取消、过期运行及旧对象版本不得提交；历史不因上下文预算删除 |

- respond的内部teaching更新扩展为带证据的add/resolve/supersede候选；范围、引用和状态转移由服务端验证。学生表达及模型推测分别保存，不用语义text去重替代稳定ID。题干更正仍通过SubjectRevision确认流程，不借记忆写接口更改已确认题目。
- 现有12条notes迁移为有来源的候选或材料引用，不补造逐字原话，不标记已核验。迁移保留原JSON和消息，不reset数据库；讲义章节目录由Artifact提供，不再占学生卡点保留名额。
- 摘要仍用ContextSummary检查点；每批学生消息的coverage包含messageId、disposition（retained/duplicate/resolved/process）、refs、reason。按消息ID恰好覆盖本批学生消息；保留项有摘要来源、重复项有保留来源、解决项有后续证据。条件/计算/要求的有效逐字引用继续保留；未解决问题是否被错误归类仍需语义评测。内部ToolExecution的tool为contextSummaryCheckpoint，resultRef保存scopeKey、完整检查点、coverage及retired来源，toolCallId=`context:<scopeKey>:<version>`；同检查点CAS事务提交，不向模型注册该审计工具、不计作业务工具调用、不把累计全量清单注入后续请求。
- readLearningContext扩展query检索模式，与现有messageIds精确读取/游标分页互斥。query限制长度，禁止任意正则/SQL；参数化查询先过滤当前账号、对象版本及可见焦点/答案，再作受控字面匹配。返回短命中片段、原消息ID、排序/分页引用；独立读取命中轮次及相邻上下文，每次有总token预算。
- 明确历史指代/来源冲突在TaskFrame增加回读要求，保存触发消息、候选引用和pending/read/clarified状态；程序检查已读有效来源或已澄清，再允许相关目标完成。自由语义仍由GPT理解，字段不伪装成数学正确性证明。
- 历史工具正文已与Message历史分离，原run.protocol/ToolExecution保留完整调用/结果，当前轮不改写toolCallId或裁剪工具配对。学习数据携带最近30个候选中最多5个可读纯读引用；`readLearningContext(ref=tool_result, executionId, offset?)`只恢复原resultRef，不执行原操作。仅subject/artifacts/messages的成功纯读可进入目录，排除attempt副作用、失败、写工具和嵌套结果回读。按账号/对象版本/焦点/原解析权限/本轮时间上界过滤，并复验材料版本、发布状态和消息可见性；旧引用失效返回STALE_REFERENCE。返回encoding=json-chunk、text、offset、complete、nextOffset，每块预算6000 tokens，须续读至complete才是完整快照。
- 主Agent与后台统一使用版本化EvidencePack：对象/来源版本、目标、创建时权限、相关条目ID及版本、必要原文/材料快照。任务创建时固定并验证，重试沿用，不临时采集其他焦点的新状态；按任务只投影需要的字段。

具体消息读模式：query/messageIds/aroundMessageId互斥，query可配beforeMessageId分页；offset用于单条messageIds续读。tool_result以executionId独立读取，不与消息搜索/游标混用，其offset是JSON快照字符偏移。每次原文正文预算6000 tokens，返回truncated/nextRead/pendingMessageIds；搜索最多扫描1000条已授权消息、返回最多10条短索引并给nextCursor。NFKC及数学符号规范化后作字面匹配，不支持任意SQL/正则。SQL先过滤账号/对象版本/焦点（含材料版本）/解析权限。

摘要保护边界由倒序历史分页计算，最近3个完整用户轮次及未回复尾部不进入覆盖游标。旧检查点已侵入保护区时按原文重建，沿用原DB版本CAS，不删除历史审计。resolved/superseded条目按原消息+逐字片段过滤相应摘要引用，同消息其他要求保留；该过滤每次装配都执行。无法用来源证明失效的语义冲突仍回读/澄清，不凭摘要自动改题。

状态变更需targetId/expectedVersion/kind/scope及当前学生原话匹配；错误尝试和模型推断为candidate，学生要求为active，条件更正为conflicted并回题干核对。superseded/resolved保留原记录、替代关系及解决证据。容量不足明确失败，不slice淘汰；相同来源和文本写入使用稳定ID去重。拒绝原因记入TaskFrame.memoryWrite.rejected。

主Agent与材料使用同一EvidencePack装配函数，schemaVersion=1，含对象版本/焦点/解析权限及相关条目ID、版本、来源。planTurn.memories在已有规划调用内提取并在工具前保存，材料payload固定该快照；讲义及练习生成/复核都收到依据。Artifact承担材料目录，不将章节标题作为学生记忆。

引用不符或能力未接入返回明确错误，不能默默退回旧12条截断或无证据摘要；实际检查见verification。

## 6 上传识别（目标契约，B03 开工约束）

上传请求声明 purpose（题目、课堂材料、解题过程、练习作答）及对应会话/对象/轮次引用；全部验证本人归属。签发受限私有对象键，附件先为 pending；complete 按附件 ID 幂等验证真实格式、可解码性及不超过 8 MB 后变为 ready，失败不可引用。临时本机路径不作为正式来源。

识别工具只收 ready 的 attachmentId，不接受任意网络地址；服务端受控读取图片交给 GPT。保存附件引用及结构化识别结果：独立题列表、共享题干小问、公式/图形条件、不确定片段。独立题各建学习对象，核对后才能据其解题；解题过程单独确认步骤，不默认为学生已认可。以请求及附件/来源版本去重，修订后拒绝旧识别结果覆盖当前内容。作答照片仅对所属轮次和题目可见。

## 7 总结图解卡（目标契约，B04-S）

- 新增独立 `summary_card` 成果/任务及显式生成操作，不能复用 lesson 当作已完成实现。
- 请求携带 requestId、subjectId、subjectRevisionId、明确理解确认消息，以及可选 artifactId/artifactVersion；确认和来源均需本人且相互匹配。没有讲义时可基于本对象已完成的教学消息生成，不扩大到整个聊天历史。
- 创建时固定已讲内容、选中材料和确认事件快照；去重键基于账号、对象版本及教学来源快照。重复点击返回同一任务/成果；主动重新生成与失败重试区分，保留旧成果。
- 独立图像生成调用计入任务预算，复核后发布私有静态图片，保存正文总结、图片引用、来源及版本。任务状态/重试沿用 jobs 契约，读取沿用 artifacts 归属校验。
- 确认理解本身不启动任务；生成失败不损坏讲义或对话，学生可跳过。缩略图、放大及从收藏详情回看复用现有容器，不另设后台菜单。


## 8 伴学学习路线与短验证（T02）

FR-13的最小存储为LearningRoute、LearningRouteNode、LearningCheck、LearningCheckEvaluation和LearningRouteEvent，独立于TeachingMemory/TaskFrame与页面LearningProgress。通过SubjectRevision关联会话及账号，不重复存储可矛盾的归属字段。respond.learning候选与完整教学回复在withActiveRun会话锁事务内一并校验提交；无效更新回滚，沿用有限协议修正，不增加独立评价模型调用。

### 8.1 学习路线

`LearningRoute` 代表一个学习对象版本下围绕一个学生目标的短路线。`LearningRouteNode` 代表可观察的学习节点。路线只保存当前学习目标和推进证据，不保存长期人格画像、跨学科知识图谱或模型内部推理。

| 实体/字段 | 约束 |
| --- | --- |
| `LearningRoute.id / subjectRevisionId` | 稳定主键；会话/账号由对象版本关联验证，题干修订后只取新版本路线，旧证据保留 |
| `LearningRoute.goal` | 学生可理解的一句话目标；来源为学生请求或已确认范围，不由模型凭空扩展课程 |
| `LearningRoute.status` | `active` / `paused` / `ended`；结束不表示所有节点通过 |
| `LearningRoute.version / createdAt / updatedAt` | 条件更新与幂等；迟到任务不得覆盖新版本 |
| `LearningRouteNode.id / routeId / position` | 同一路线内稳定顺序；依赖只用于推荐，不能作为权限绕过 |
| `key / objective / prerequisites` | 路线内稳定key、可观察目标和前置key；依赖必须是同路线更早节点，不能形成循环 |
| `status` | `pending` / `learning` / `checked` / `needs_review` / `skipped` |
| `passCriteria` | 版本化的最小验证条件；不得只存一个模型生成的百分比 |
| `checks / evaluations` | 节点关联短验证及追加评价，保存学生原话和帮助；材料/正式作答直接引用后续再接 |
| `version / updatedAt` | 状态转移带期望版本；历史状态保留，不能无条件覆盖 |

路线建议通常 3～5 个节点，但数量不是接口硬限制；简单目标可少于 3 个。学生跳过、暂停或调整目标时保存原因和来源，不删除旧路线证据。跨对象、旧题干版本和新练习不继承 `checked` 状态。

路线固定contentProfileId/contentProfileVersion，通过sourceMessageId/sourceQuote/sourceRunId保留目标依据；profile表示内容规则、工具与评价依据，不是学科菜单。首期只注册math@1；其他内容为unconfigured@1。换例、变式可继续当前节点；目标变化用replaces引用旧路线及版本，旧证据不转为新目标已通过。材料/例题仍由当前对象与教学记忆提供，不冒充短验证直接作答来源。

### 8.2 教学验证

`LearningCheck` 是对话内针对一个节点的短验证，不等同 FR-06～08 的正式练习、自评或考试成绩。它可引用一段变式题、一个关键判断或一个解释任务；通过条件和依据必须在创建时保存。

| 字段 | 约束 |
| --- | --- |
| `id / nodeId / sourceRunId / issuedMessageId` | 通过节点关联路线与对象版本；验证随完整助手回复保存，后续学生回答才可评价 |
| `taskKind / rubricVersion` | 描述验证方式及评价规则版本，可为判断、解释、比较、应用或作品任务；不把所有学习限定为唯一数值答案，首期仅实现所需数学任务 |
| `prompt / criteria` | 任务须原样展示在回复中；复制节点预存的可观察条件及requiresIndependent，不存/注入参考答案 |
| `LearningCheckEvaluation.attemptMessageId / answerSnapshot` | 当前本人学生原文，必须晚于验证发布，同回答对同check不重复累计；照片/正式作答直接引用后续再接 |
| `evaluation` | `pass` / `needs_review` / `insufficient_evidence` / `uncertain`；由受控评价结果提出，程序校验完整性 |
| `supportLevel` | `independent` / `hinted` / `explained` / `solution_seen` / `skipped` |
| `rubricVersion / criteriaResults` | profile与条件快照；逐项覆盖criterionId/met/evidenceType/学生逐字quote/简短反馈，自述、复述和不明确证据不得pass；引用不等于数学证明 |
| `createdAt` | 再次回答追加评价，不删除原回答；已pass验证只读，节点再验证/回退另行收口 |

只有 `pass` 且满足当前版本 `passCriteria` 的验证，才可提出节点转为 `checked`；学生自述、助手讲解、一次自评或看过解析后的复述不能单独触发。`uncertain` 与 `insufficient_evidence` 不应伪装成失败分数；允许学生继续、重试或跳过。误解记录仍写入 `TeachingMemory`，通过关联 `evidenceRefs` 与节点，不另建一套无来源画像。

### 8.3 事件与页面同步

SSE统一发布route.updated完整可读快照，不另维护node.updated/check.recorded两套增量投影。事务提交后才发送节点状态与最新短验证提示/结论，不下发条件详情、参考答案或内部评价反馈。正文仍流式，结构化状态等待完整校验；前端按对象版本、routeId/version和路线创建顺序过滤迟到状态，重进从会话详情learningRoute恢复。

PUT /api/conversations/:id/subjects/:subjectId/learning-route接收requestId、routeId、expectedVersion、action=pause/resume/skip及可选nodeId。本人当前对象、空闲运行和版本CAS在会话锁内核验；相同requestId同内容幂等、异内容冲突。跳过不写checked。操作不调用模型，“接着学”只预填输入。

帮助按none/hint/explanation/solution单调升级；缺省保守记explanation，同对象验证未完成时进入阅读页也记讲解暴露。评价前还回读验证发布与学生回答之间的助手消息：中断或旧消息缺失帮助元数据时保守记讲解，避免停止后丢失已展示帮助。只允许当前节点最新验证参与推进，旧验证被替代后不可借其通过当前节点。评价保存回答发生前的帮助，当前回复的进一步帮助只影响后续回答。条件覆盖、引用及帮助校验不能证明模型语义评价正确，也不能证明学生未使用应用外帮助。
