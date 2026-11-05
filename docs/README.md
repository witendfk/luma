# Luma 文档索引

本目录是项目文档唯一正文来源，随 `feature` 分支版本管理。文件及目录名使用英文，正文使用中文。整理日期：2026-11-05。

## 文档职责

| 文档 | 回答的问题 | 应写内容 | 不应写内容 |
| --- | --- | --- | --- |
| [spec/PRD.md](spec/PRD.md) | 产品做什么、为谁做 | 目标、业务流程、FR、P0/P1、业务约束和非功能需求 | 代码方案、排期、测试结果 |
| [spec/acceptance.md](spec/acceptance.md) | 怎样算做完 | AC、业务场景、验收层级和通过标准 | 当轮通过/失败记录 |
| [design/interaction.md](design/interaction.md) | 学生怎样使用 | 页面、布局、操作、反馈、跳转及返回恢复 | 接口细节、施工日志 |
| [design/architecture.md](design/architecture.md) | 系统怎样分工 | 组件职责、业务状态、内容呈现与跨模块规则 | 逐任务状态、测试流水 |
| [design/agent.md](design/agent.md) | Agent 内部怎样运行 | 执行循环、工具、提示词、上下文、记忆、预算及恢复 | 需求替代品、完成率 |
| [design/backend-review.md](design/backend-review.md) | 当前服务接入方案哪里有差距 | 一次评审的代码证据、技术判断和整改关联 | 实施进度或新的产品范围 |
| [design/data-api.md](design/data-api.md) | 数据如何关联、前后端如何通信 | 实体、约束、API/事件、鉴权及契约差异 | 页面截图说明和开发日志 |
| [design/decisions.md](design/decisions.md) | 为什么选这套技术 | 选型、原因、取舍和引入边界 | 复制 Agent 伪代码、任务清单 |
| [delivery/plan.md](delivery/plan.md) | 下一步谁做什么、先后如何 | 任务、依赖、产出、完成条件及职责分工 | 已完成流水和功能定义 |
| [delivery/progress.md](delivery/progress.md) | 现在做到哪里 | 当前模块状态、基线、差距及下一步 | 需求全文、架构方案 |
| [delivery/verification.md](delivery/verification.md) | 实际验证过什么 | 环境、版本、操作、结果、限制和证据 | 新增需求、猜测完成状态 |
| [delivery/release.md](delivery/release.md) | 怎样扫码独立使用 | 部署、平台配置、体验版上传和交付检查 | 当前开发进度 |
| [development.md](development.md) | 本地怎样运行和排错 | 依赖、命令、开关、导入及故障排查 | 产品设计、历史验收结论 |

## 阅读顺序

了解产品：PRD → 验收规格 → 交互设计。开发实现：系统设计 → Agent/数据接口设计 → 技术决策 → 实施计划。继续工作前：进度 → 验证记录 → 当前任务；本地启动查开发手册。

## 维护规则

1. 业务行为变化先改 PRD；验收标准变化改 acceptance，再更新相关设计。状态变化不改写需求。
2. 页面流程只在 interaction 维护；跨组件设计放 architecture；Agent 内部规则放 agent；协议与迁移放 data-api。
3. 开发前在 plan 定义任务，完成后在 progress 更新当前状态，在 verification 留环境与证据。三者互链，不重复全文。
4. 设计是目标约束，代码/共享 schema 是当前实现。两者有差距时明确记录并列任务，不把骨架说成已验收，也不让旧接口反向删减已确认需求。
5. 当前用户确认优先于旧文件。发现冲突先核对确认记录；不能凭“某份文件更新更晚”自动扩大范围。
6. 只维护一份现行正文，不并存“最终版/最新版/修订版”。过时描述合并删除，历史从 Git 追溯。
7. `apps/server/src/agent/prompts/*.md` 是运行时提示词，属于代码资源，不纳入产品文档重命名或内容清理。

## 旧文档迁移

| 原位置 | 当前位置 |
| --- | --- |
| `需求分析.md` | `spec/PRD.md`、`spec/acceptance.md` |
| `技术选型.md` | `design/decisions.md` |
| `设计文档.md` | `design/architecture.md`、`interaction.md`、`agent.md`、`data-api.md`；计划与交付内容移至 `delivery/` |
| `实施进度.md` | `delivery/progress.md`；任务拆至 `plan.md`，证据拆至 `verification.md` |
| `本地联调.md` | `development.md` |
| `产品原型/移动端-交互说明.md` | 外层 `产品原型/README.md`，仅保留原型使用说明 |

部分旧代码注释仍使用原“设计文档 §n”编号，其定位映射如下；文档整理不修改运行代码或提示词。

| 原章节 | 当前设计位置 |
| --- | --- |
| §1 | architecture §1 |
| §2 | interaction |
| §3 | architecture §2 |
| §4～§8 | agent §1～§5（子编号保持对应，如原 §4.12 对应 §1.12） |
| §9～§11 | data-api §1～§3 |
| §12 | delivery/plan |
| §13 | spec/acceptance |
| §14 | delivery/release |

[工程入口](../README.md) · [原型说明](../../产品原型/README.md)
