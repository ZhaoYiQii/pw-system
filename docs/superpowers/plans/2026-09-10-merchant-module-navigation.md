# Merchant Module Navigation Implementation Plan

Goal: 将商家端改造成简洁的两级折叠导航，并以 active、preview、planned 三种状态安全呈现完整功能版图。
Status（2026-09-11 回填）：Task 1 与 Task 2 已在**工作树**实现（未提交）：8 个业务域注册表、两级折叠侧栏、active/preview/planned 三态与预览面板均已落地，`modules.spec.ts` 6 用例全绿，`tests/e2e/merchant-console-admin.spec.ts` 断言已同步更新。Task 3 的 admin typecheck/build 与浏览器走查未在本次核对中复跑，计划中的这些验证项仍视为待补证据。提交与推送需单独授权。

Architecture: 在现有 `modules.ts` 注册表上增加业务域、状态和可见性元数据，由纯函数生成角色可见导航。MerchantShell 只消费注册表并管理展开与预览面板状态；现有活动模块继续复用原路由，未接线模块不请求 API。

Tech stack: Next.js 16.3.4、React 19.2.8、TypeScript 5.9.3、Vitest 3.2.7、lucide-react 1.41.0、现有 scoped CSS。

Spec: `docs/specs/merchant-navigation-information-architecture-v1.md`

Scope and non-goals: 只修改商家端导航注册表、侧栏组件、图标映射、对应样式与单元测试；不新增 API、数据库、依赖、真实营销/提现/市场能力，不修改陪玩端，不提交、不推送、不部署。

Permission gates: 本地产品代码写入已由用户在当前对话批准；Git commit、push、依赖变更、数据库变更和部署仍需单独授权。

Completion evidence: 定向 Vitest 通过、admin typecheck 通过、admin build 通过、商家端浏览器走查确认折叠/状态/角色/窄屏行为且控制台无阻断错误。

## 项目约束

- TypeScript strict；不得使用 any 或忽略类型。
- 新功能不得伪造后端成功或业务；preview/planned 不调用业务 API。
- 前端菜单不是安全边界；现有后端角色授权保持不变。
- 保留工作树中已有的搜索栏、可访问性和视觉优化改动。
- 不安装依赖，不创建分支或提交，不修改数据库、OpenAPI 或移动端。

## Task 1：先锁定导航状态与角色行为

- [ ] 在 `modules.spec.ts` 声明 8 个业务域、现有活动模块角色计数、OWNER 预览可见性。
- [ ] 运行定向测试并确认因缺少新注册表行为而失败。
- [ ] 在 `modules.ts` 增加 MerchantModuleStatus、MerchantNavDomain、MerchantNavItem，以及 getVisibleNavDomains 和 getModuleDomain。
- [ ] 保留 getVisibleNavGroups 兼容调用方，运行测试确认通过。

Verification: `corepack pnpm vitest run apps/admin-web/app/_lib/merchant-console/modules.spec.ts`

Rollback: 回退 modules.ts 和 modules.spec.ts 的增量修改；无持久数据副作用。

## Task 2：实现两级折叠与状态预览

- [ ] 修改 `merchant-shell.tsx`，让当前业务域自动展开，一级按钮具备 aria-expanded/aria-controls。
- [ ] active 使用 Link；preview 打开说明面板且不请求 API；planned 仅汇总并在面板展示。
- [ ] 修改 `icons.tsx` 增加业务域图标静态映射。
- [ ] 增量修改 `merchant-console.css`，保留已有 skip-link、移动抽屉和焦点优化。

Verification: `corepack pnpm --filter @pw/admin-web typecheck`

Rollback: 回退本任务三个文件的增量修改，现有路由无数据迁移影响。

## Task 3：构建与浏览器验收

- [ ] 运行定向单测、admin typecheck 和 production build。
- [ ] 用 owner 检查 8 个一级域、三种状态和当前域自动展开。
- [ ] 用受限角色确认未启用模块不暴露，活动路由仍可达。
- [ ] 在窄屏检查抽屉、展开、关闭和焦点行为。
- [ ] 检查浏览器控制台；只在公开标签确实变化时更新精确 E2E 断言。

Verification:

- `corepack pnpm vitest run apps/admin-web/app/_lib/merchant-console/modules.spec.ts`
- `corepack pnpm --filter @pw/admin-web typecheck`
- `corepack pnpm --filter @pw/admin-web build`
- `corepack pnpm playwright test tests/e2e/merchant-console-admin.spec.ts`

Rollback: 无数据库或远程副作用；回退本 Slice 的精确文件即可恢复旧侧栏。
