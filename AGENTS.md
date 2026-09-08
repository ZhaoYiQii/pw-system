# 陪玩门店 SaaS — AI 开发总规则

本文件适用于仓库全部目录。更近层级的 `AGENTS.md` 只能增加约束，不能放宽本文件规则。

## 开始任务前

1. 完整阅读 `AI_START_HERE.md`、`PROJECT_STATUS.md` 和 `docs/specs/陪玩门店多租户SaaS-H5-开发主规格-v1.0.md`。
2. 检查当前仓库、运行时、包管理器、锁文件、迁移、测试和 Git 状态；不得根据记忆假设它们存在。
3. 明确本次任务的 Slice 编号、允许修改的准确路径、验收命令和权限边界。
4. 没有用户明确批准的 Slice，不得写业务代码；一次只实施一个 Slice，不得自动进入下一 Slice。

## Skill 自动使用映射（一环节一 skill）

- 规则：开始一个环节前，必须先从下表选出唯一对应 skill，完整读取其 `SKILL.md` 后执行；同一环节禁止叠加多个同职责 skill。
- 多环节任务由 `development-lifecycle-router` 决定进入顺序，进入每个环节时只激活该环节的 skill；不允许跨环节保持多个 workflow skill 同时激活。
- 若某环节没有对应 skill 或 skill 缺失：停下说明缺口，不静默降级；可以回退到通用能力，但必须明确报告“未使用 skill”。
- 本表 2026-09-07 由用户批准；`code-review` 与 `frontend-design` 保留本机 Codex 版，禁止再安装同名外部版本覆盖。（2026-09-08 新增“前端 UI 任务入口”行：`pw-frontend-ui`，其余行与条款不变。）

| 开发环节 | 必须使用的 skill | 说明/触发 |
| --- | --- | --- |
| 需求/产品设计 | brainstorming | 出现需求不清、方案选择、架构/行为不确定性时 |
| 切片/实现计划 | writing-plans | 已批准架构设计后进入可执行计划时 |
| 多阶段流程路由 | development-lifecycle-router | 一个请求跨越多个开发/审查/发布阶段时 |
| 架构与代码库改进 | improve-codebase-architecture | 重构、模块边界、依赖设计、代码组织 |
| API/接口设计 | api-and-interface-design | 设计或审查 REST/接口契约、schema、边界 |
| 前端 UI 任务入口 | pw-frontend-ui | admin/mobile 任何 UI 任务先由本技能判型并选定唯一子技能，随后按需进入“前端 UI 设计”“React/Next 编码”等行；判型前禁止并行叠加多个 UI 技能 |
| 前端 UI 设计 | frontend-design | 新建/重做 UI 的视觉与体验方向 |
| React/Next 编码 | vercel-react-best-practices | 编写/审查 React、Next、服务端组件性能模式 |
| 数据库/迁移设计 | supabase-postgres-best-practices | 写表/列/迁移/索引/CHECK/RLS 前必须读取 |
| 测试驱动实现 | tdd | 有可执行测试缝隙的行为先红后绿 |
| E2E/浏览器回归 | playwright-skill | 提交持久 Playwright 测试时 |
| 排错/根因分析 | systematic-debugging | 失败、异常行为、门禁故障时先定位根因 |
| 安全加固 | security-and-hardening | 涉及鉴权、密钥、加密、外部输入、数据边界 |
| 性能优化 | performance-optimization | 慢查询、慢页面、构建/运行性能问题 |
| 无障碍 | accessibility | 检查/修复 UI 可访问性 |
| Git/版本流程 | git-workflow-and-versioning | commit 规范、分支策略、冲突处理 |
| 代码审查 | code-review | 提交前后/阶段收口对改动做只读审查 |
| 完成声明 | verification-before-completion | 声称“完成/通过/可部署”前采集当前证据 |

## 事实与冲突优先级

事实优先级依次为：当前代码与数据库迁移 > 本文件 > 已批准主规格与 ADR > 锁定版本官方文档 > 新鲜命令输出 > 推断。

- 发现两份事实冲突时停止，列出文件、行号和影响，请用户决定。
- 不得猜测字段、状态、价格、权限、微信接口、第三方 SDK 或环境变量。
- 不得使用博客、旧项目或模型记忆替代锁定版本的官方文档。
- 架构、技术栈、数据边界或业务状态机变化必须先形成 ADR 并得到批准。

## 实施规则

- 使用 TypeScript strict；不得以 `any`、忽略类型或关闭规则绕过错误。
- 后端保持 NestJS 模块化单体；领域层不得依赖 NestJS、Prisma 或平台 SDK。
- 每个租户资源必须在服务端绑定 `TenantContext`；禁止信任客户端提交的 `tenantId`。
- 移动端业务代码必须同时面向 H5 和 weapp；`window`、`document`、`localStorage`、`wx` 只能出现在平台适配目录。
- API 契约来自 OpenAPI；生成客户端不得手工修改。
- 金额使用整数分或明确的十进制值对象，禁止 JavaScript 浮点金额。
- 状态变化、金额调整、结算与外部副作用必须满足幂等、事务、并发和审计要求。
- 不得创建空实现、始终成功的 Provider、吞异常的 `catch`、伪造命令输出或空测试脚本。
- 开发用 Fake Provider 在生产环境必须硬失败，不能静默启用。
- 只修改当前 Slice 拥有的文件；需要越界时停止并说明原因。

### 前端技术栈（G4 渐进式迁移）

- 2026-09-07 用户决定：admin 前端采用渐进式迁移，新功能一律使用新栈；旧页面“改到即迁”，目标是把全部程序逐步迁移到新栈。
- 新栈基线：Tailwind v4（`apps/admin-web/app/globals.css` 中的 token 与 utilities）、shadcn/ui 风格组件（`apps/admin-web/components/ui/*`）、TanStack Query 服务端数据、Zustand（仅出现共享全局状态时再引入，不得为了用而用）。
- 新增或重写 admin 页面/组件时必须使用新栈；不得在新页面继续使用旧 `globals.css` 自建 `.card/.btn/.data-table` 等遗留类。
- 修改一个旧页面时，应把该页一次性迁移到新栈（含数据请求改用 TanStack Query）；不得在同一页面同时混用旧类与新组件。
- 未在当前任务范围内且未被触碰的旧页面不主动迁移，避免无关改动扩散；迁移到某页后从任务清单记录该页状态。
- 移动端 Taro（H5/weapp）不引入 Tailwind/shadcn；TanStack Query/Zustand 若引入必须先经平台契约/ADR。
- 所有旧样式只可在没有活动使用方后，作为独立清理任务删除；删除前用 `rg` 验证无引用。
- 迁移不得改变后端 API、金额、权限、租户隔离或既有门禁；每次迁移后跑 admin typecheck/lint/build。

## 测试与完成声明

有可执行测试缝隙的行为必须先建立失败测试，再做最小实现。任何失败先复现和诊断一个可证伪的根因，不得连续盲改。

完成时必须报告：

- 修改的准确文件；
- 数据库迁移与回滚方式；
- API 契约变化；
- 租户、权限、输入、幂等和并发检查位置；
- 本次调用/读取的 skill 清单：名称、SKILL.md 路径与状态（成功完整读取并执行 / 缺失 / 损坏 / 未使用及原因）；未调用任何 skill 时明确说明；
- 实际执行的命令、退出码和关键输出；
- 未验证、降级或未完成的能力。

“已改代码”“已本地验证”“已提交”“已推送”“已部署”“已生产验证”是不同状态，禁止混用。缺少新鲜证据时只能标记未验证。

## 必须单独取得授权的动作

以下动作不得从普通开发请求推断获得授权：

- 安装、删除或升级依赖与 CLI；
- 初始化 Git、创建分支、提交、推送或上传源码；
- 下载或运行安全扫描器及规则集；
- 启动会改变数据的容器或服务；
- 修改本地非测试数据、远程数据库或云资源；
- 执行数据库迁移、部署、回滚；
- 配置真实密钥、微信 AppID/AppSecret、支付或 AI Provider；
- 提交、审核或发布微信小程序。

每次请求授权时必须列出准确目标、命令、影响和恢复方式。

## 平台约束

- 开发主机可以是 Windows，但正式构建目标是 Linux 容器。
- 文本使用 UTF-8 与 LF；导入路径大小写必须与文件名完全一致。
- 禁止业务代码包含 Windows 绝对路径。
- 本地 PostgreSQL、Redis 和对象存储最终通过 Docker Desktop 的 Linux 容器运行。
- 没有完成 Linux 容器验证时不得声称可部署到 Linux。
