# Luma Documentation

更新日期：2026-11-06。产品和技术文档以本目录为准；英文文件名、中文正文。运行时提示词与Skill属于代码资源，上游资料属于参考，不与现行规格混用。

## Start here

- **继续任务**：[当前进度](delivery/progress.md) → [执行顺序与任务](delivery/plan.md) → 只读相关设计和验证证据。
- **了解产品**：[PRD](spec/PRD.md) → [验收标准](spec/acceptance.md) → [交互](design/interaction.md)。
- **启动排错**：[development](development.md)。不需要每次重读整个docs或历史评审。

## Spec

| 文档 | 唯一职责 |
| --- | --- |
| [PRD](spec/PRD.md) | 用户、业务目标、功能范围和业务约束；不写实施进度 |
| [acceptance](spec/acceptance.md) | 稳定AC和通过条件；不记录某轮检查结果 |

## Design

| 文档 | 唯一职责 |
| --- | --- |
| [interaction](design/interaction.md) | 页面呈现、操作、跳转、返回与体验边界 |
| [architecture](design/architecture.md) | 系统分工、状态边界和跨模块关系 |
| [agent](design/agent.md) | 执行循环、工具权限、上下文、预算和恢复 |
| [tutoring](design/tutoring.md) | 教学策略、节点推进、验证证据与Sigma取舍 |
| [data-api](design/data-api.md) | 实体/版本/来源、API与事件契约、兼容和目标契约 |
| [decisions](design/decisions.md) | 技术选择及原因；不再维护一套任务或能力状态 |

## Delivery

| 文档 | 唯一职责 |
| --- | --- |
| [plan](delivery/plan.md) | 任务定义、依赖、顺序、完成条件；不写完成流水 |
| [progress](delivery/progress.md) | 当前状态快照、已接入/已验证/待完成及阻塞；更新原条目 |
| [verification](delivery/verification.md) | 验证时点、环境、操作、结果、证据和限制；历史不冒充当前 |
| [release](delivery/release.md) | 交付阶段部署、微信配置、成员和体验版操作 |
| [development](development.md) | 本地配置、命令与排错；不维护功能完成清单 |

## Resources and history

- [产品Agent Skill](../apps/server/src/agent/skills/luma-tutor/SKILL.md)及`prompts/*.md`：服务端运行资源。实际加载由代码完成，不因MD存在就等于已接入。
- [Sigma原文快照](../references/sigma/UPSTREAM.md)：固定版本的上游参考，离线可读，不能覆盖Luma策略或项目约定。
- [历史评审](archive/reviews.md)：合并原backend-review、project-review、agent-capability-review；只追溯当时发现，当前缺口和顺序不从这里读取。
- [原型说明](../../产品原型/README.md)：HTML仅为视觉/交互参考，不证明小程序或接口已完成。

## Maintenance

1. **任务推进当轮同步文档**：progress更新原状态；顺序/依赖变化改plan；做过验证改verification，无验证明确说明。用户未提醒也要执行。
2. 只有业务、交互、机制或协议真的变化时才改对应spec/design；实现进度不复制到每份文档。
3. 设计表达目标约束，代码和schema表达实现；已接入、定向检查通过、真实行为通过、业务验收通过不能互相替代。
4. 同一事实只在所属文档维护，其他地方引用。旧状态从现行正文移除，必要证据留verification，阶段评审进入archive，不再新增“最终版/最新补充版”。
5. 历史测试数属于当时工作区；当前代码变化后不能自动继承“全部通过”。不使用旧评审、旧mock或未实现目标契约作为完成依据。
6. [AGENTS.md](../AGENTS.md)约束后续执行；用户最新明确要求优先。确认后才commit、push；文档整理不触发模型调用、生产构建或部署。

早期中文文档已拆入当前目录。旧代码注释“设计文档§4～§8”对应agent§1～§5，“§9～§11”对应data-api§1～§3；只在维护相关代码时更新，不另建重复映射文档。
