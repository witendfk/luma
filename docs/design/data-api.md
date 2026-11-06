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
| `POST /conversations/:id/subjects` | 创建独立对象；旧 action=update/confirm 仅为历史契约兼容 |
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

### 2.1 教学回复展示契约

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
- `PracticeAttempt` 共享 DTO 使用 `exercises[].myAnswer`，无顶层 answers；历史接口已提供。开始/重做的 requestId 和 redoOfAttemptId 尚待 B05。
- 取消收藏记录 `removedAt`，重新收藏复用原行。列表只展示未取消项，详情可读回保留的笔记。
- 归档/恢复/重命名不更新学习时间；真实新消息在创建运行事务内取消归档，前端不预先发恢复请求。
- 迁移`20261105090000_learning_subjects`为每个旧会话建立首对象，保留旧字段和既有材料/练习；其他环境执行增量migrate deploy，不使用reset。执行证据只在verification维护。
- 小程序正式路径只调用真实服务，不因接口未接入回退示例数据；各页面完成状态见progress。

## 5 对象级教学上下文（B04-R）

### 5.1 数据与来源

`SubjectRevision.teachingState`是只读兼容JSON，对应迁移`20261106090000_teaching_state`。旧结构为version/notes，notes包含difficulty、method、openQuestion、来源消息/材料/焦点及containsSolution；旧12条限制只用于解释历史数据，**不再作为新记忆的写入或保留策略**。旧JSON不再随回复更新，不按旧resolved字段清空。新记录统一走§5.3的TeachingMemory及`planTurn.memories`/`respond.teaching.operations`。

页面位置`LearningProgress`、语义记忆`TeachingMemory`和过程摘要`ContextSummary`各自负责不同数据，不能相互覆盖。

滚动摘要独立存 `ContextSummary`：`subjectRevisionId + scopeKey` 唯一，scopeKey包含材料版本/段落、练习轮次/题目及本轮解析权限；body.notes 保存 kind/text/refs/可选quote。条件、计算和要求必须逐字引用，原消息ID必须属于输入或已有摘要。`throughMessageId / throughCreatedAt / coveredMessages` 固定已覆盖边界，`version` 用于并发保存；更新与取消共用会话锁及活动运行校验。只保留最新摘要检查点，不删除原文。迁移 `20261106110000_context_summary` 已应用本地库。

新的运行不预先按token裁掉历史；驱动器按覆盖游标加载后续原文，必要时将旧摘要与新增旧轮次交GPT合并，保存成功再继续。失败保留原文与已提交检查点；摘要不通过校验不得推进覆盖游标。旧权限、其他焦点和旧题干版本的摘要均不装配。

`teachingMode` 由 policy 按当前对象和确认过程产生，不存成学生长期属性。理解确认事件及其专用去重契约仍归 B04-S，尚未实现；不能以现有 notes 冒充已完成。状态内部更新使用会话锁/活动运行检查，不新增客户端任意写入接口。

### 5.2 按需读取与修订

- `readLearningContext` 已支持当前对象版本内的材料引用和消息 cursor/有限条数或messageIds精确读取，过滤归属、版本、完成状态、焦点及解析权限；不支持直接回读旧题干版本。旧版本跨版本工具读取仍后置，不冒充当前事实。
- 章节追问输入固定 `subjectId / subjectRevisionId / artifactId / artifactVersion / sectionId`；练习追问另带 attemptId/exerciseId。服务端验证归属和对应关系，再按权限投影。
- 页面返回位置仍写 `LearningProgress`，与教学理解记录分别维护；结束追问清除本轮局部焦点，不删除教学记录。
- 局部重讲任务固定上述来源及原材料快照、原段落、学生要求和创建时权限。worker 不重新读取当前焦点作为输入；发布前复验来源版本及权限。只有指定段落变更，其余段落沿用原内容和稳定标识；产生新材料版本，不覆盖旧成果。
- 切题加载该对象自己的状态；题干修订使旧语义记录不参与当前装配，旧数据仍保存在数据库，当前工具不跨题干版本回读。切换练习轮次不继承旧解析授权。完成/取消/修订的迟到更新按并发版本拒绝。

### 5.3 教学记忆与回读契约

§5.1旧JSON保留兼容历史，新依据从TeachingMemory读取。迁移`20261106160000_teaching_memory`保留旧JSON和消息，旧条目为candidate，不补造原话或核验结论；不提供客户端任意写记忆接口。下文标注AG02.3的覆盖清单和紧凑化是目标契约；已接入/待接入范围只在progress维护。

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
- **待实施AG02.3**：摘要仍用ContextSummary检查点；增加关联覆盖清单（消息ID、处理类别、条目/来源引用），存储在DB，不把全量清单每轮注入模型。校验本次被覆盖学生消息均有处理、已有有效关键条目及未解决问题未被无理由丢弃、替代关系有效；不声称此检查证明语义完整。
- readLearningContext扩展query检索模式，与现有messageIds精确读取/游标分页互斥。query限制长度，禁止任意正则/SQL；参数化查询先过滤当前账号、对象版本及可见焦点/答案，再作受控字面匹配。返回短命中片段、原消息ID、排序/分页引用；独立读取命中轮次及相邻上下文，每次有总token预算。
- 明确历史指代/来源冲突在TaskFrame增加回读要求，保存触发消息、候选引用和pending/read/clarified状态；程序检查已读有效来源或已澄清，再允许相关目标完成。自由语义仍由GPT理解，字段不伪装成数学正确性证明。
- **待实施AG02.3**：大只读工具结果沿用ToolExecution中的正式结果或有权限材料引用；发送给模型的紧凑版携带原toolCallId和可回读引用，不修改原执行记录或重复执行写工具。完整本轮协议仍可恢复。
- 主Agent与后台统一使用版本化EvidencePack：对象/来源版本、目标、创建时权限、相关条目ID及版本、必要原文/材料快照。任务创建时固定并验证，重试沿用，不临时采集其他焦点的新状态；按任务只投影需要的字段。

具体读模式：query/messageIds/aroundMessageId互斥，query可配beforeMessageId分页；offset仅用于单条messageIds续读。每次原文正文预算6000 tokens，返回truncated/nextRead/pendingMessageIds；搜索最多扫描1000条已授权消息、返回最多10条短索引并给nextCursor。NFKC及数学符号规范化后作字面匹配，不支持任意SQL/正则。SQL先过滤账号/对象版本/焦点（含材料版本）/解析权限。

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


## 8 伴学学习路线与验证目标契约（T02，目标契约）

本节定义 FR-13 的最小数据边界，供后续 T02 实施评审。当前数据库尚未接入这些表；不得把现有 `TeachingMemory`、`TaskFrame` 或 `LearningProgress` 临时拼接后宣称已实现。所有记录都必须沿用会话、账号、`subjectRevisionId` 和活动运行的归属校验。

### 8.1 学习路线

`LearningRoute` 代表一个学习对象版本下围绕一个学生目标的短路线。`LearningRouteNode` 代表可观察的学习节点。路线只保存当前学习目标和推进证据，不保存长期人格画像、跨学科知识图谱或模型内部推理。

| 实体/字段 | 约束 |
| --- | --- |
| `LearningRoute.id / accountId / conversationId / subjectRevisionId` | 稳定主键；会话、账号和题干版本必须一致，题干修订创建新路线或明确标记旧路线只读 |
| `LearningRoute.goal` | 学生可理解的一句话目标；来源为学生请求或已确认范围，不由模型凭空扩展课程 |
| `LearningRoute.status` | `active` / `paused` / `ended`；结束不表示所有节点通过 |
| `LearningRoute.version / createdAt / updatedAt` | 条件更新与幂等；迟到任务不得覆盖新版本 |
| `LearningRouteNode.id / routeId / position` | 同一路线内稳定顺序；依赖只用于推荐，不能作为权限绕过 |
| `conceptRef / objective / prerequisites` | 可选通用概念引用、可观察目标和依赖；首期数学内容配置提供语义，不把年级写死在循环中 |
| `status` | `pending` / `learning` / `checked` / `needs_review` / `skipped` |
| `passCriteria` | 版本化的最小验证条件；不得只存一个模型生成的百分比 |
| `evidenceSummary` | 关联验证记录、学生原话和帮助级别的摘要；原文及正式题组通过引用读取 |
| `version / updatedAt` | 状态转移带期望版本；历史状态保留，不能无条件覆盖 |

路线建议通常 3～5 个节点，但数量不是接口硬限制；简单目标可少于 3 个。学生跳过、暂停或调整目标时保存原因和来源，不删除旧路线证据。跨对象、旧题干版本和新练习不继承 `checked` 状态。

### 8.2 教学验证

`LearningCheck` 是对话内针对一个节点的短验证，不等同 FR-06～08 的正式练习、自评或考试成绩。它可引用一段变式题、一个关键判断或一个解释任务；通过条件和依据必须在创建时保存。

| 字段 | 约束 |
| --- | --- |
| `id / nodeId / subjectRevisionId / conversationId` | 归属当前路线、对象版本和会话；不可跨题复用 |
| `prompt / expectedEvidence` | 学生可读的验证任务与需要观察的证据；不把参考答案注入普通引导上下文 |
| `attemptMessageId / answerSnapshot` | 学生原始回答或作答来源；保留提示、讲解、解析查看和照片引用 |
| `evaluation` | `pass` / `needs_review` / `insufficient_evidence` / `uncertain`；由受控评价结果提出，程序校验完整性 |
| `supportLevel` | `independent` / `hinted` / `explained` / `solution_seen` / `skipped` |
| `criteriaVersion / evidenceRefs` | 通过条件版本、来源消息/材料/题目及必要原文引用；引用不等于数学证明 |
| `createdAt` | 只追加；修正评价新增版本并关联旧记录，不删除原回答 |

只有 `pass` 且满足当前版本 `passCriteria` 的验证，才可提出节点转为 `checked`；学生自述、助手讲解、一次自评或看过解析后的复述不能单独触发。`uncertain` 与 `insufficient_evidence` 不应伪装成失败分数；允许学生继续、重试或跳过。误解记录仍写入 `TeachingMemory`，通过关联 `evidenceRefs` 与节点，不另建一套无来源画像。

### 8.3 事件与页面同步

服务端发布 `route.updated`、`node.updated`、`check.recorded` 事件时只发送已校验的状态、版本和可读摘要；不把模型规划 JSON、内部评分理由或提示词发给小程序。SSE 中途可展示教学正文，节点更新等结构化事件须完整校验后发送。重复事件按 `routeId + version` 去重，页面重进以数据库版本为准。
