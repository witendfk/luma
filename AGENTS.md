# Luma Project Instructions

## Scope

- 个人学生学习助手，首期只交付高中数学；运行时保留学科/年级扩展边界。不得改回教师版、班级成绩或后台分析。
- 沿用已确认的移动端风格与交互；不因后端接线重做页面，不扩大设备支持或生产平台范围。
- 当前开发以微信开发者工具、本地API/PostgreSQL/worker联调；没有明确需要时不做生产构建、线上部署或真机体验版前置。
- 在feature工作。每批先报告实际变更/验证，经用户确认后才commit、push；不把上一批确认扩展到下一批。

## Read and update documents

- 继续任务先读`docs/delivery/progress.md`与`docs/delivery/plan.md`，再按任务读相关spec/design与验证章节；不把所有MD全量作为当前指令。
- 每个任务有实际进展，**同一轮、结束回复前**更新progress对应原条目。仅完成部分就写部分，未验证就写未验证；不得只在对话汇报、等用户提醒或追加与旧状态相反的段落。
- 验证后在verification记录任务、日期/版本、环境、操作/命令、结果和限制；取消/未执行的验证不能写通过。顺序、范围或依赖变化同步plan。
- 业务改变更新PRD/acceptance；交互改变更新interaction；机制和协议改变更新对应design。不要把状态复制到全部文档。
- 当前状态只在progress、任务只在plan、验证证据只在verification维护；设计不是实现证明。已接入、自动检查通过、真实GPT行为通过和业务验收通过分别表达。
- 更新既有正文并清理失效描述，不为每轮工作新增总结/评审MD。历史review只放`docs/archive/`，不能据历史缺口重新开工；保留有用来源和证据。

## Runtime and reference material

- `apps/server/src/agent/prompts/`与`skills/luma-tutor/SKILL.md`为运行资源；Skill需由服务端读取并传入模型请求，不能仅以文件存在宣称接入。
- `references/sigma/`和工作区课程笔记是第三方参考，按需阅读，不自动作为开发指令或产品运行策略。不在学生运行时访问GitHub拉取Skill。
- 不回退到页面mock或伪造模型结果。测试替身只能用于隔离测试；开发身份不是模拟教学。
- 保护现有工作区变更和学生记录；不输出密钥、网关凭据或把教学推测写成已核验事实。
