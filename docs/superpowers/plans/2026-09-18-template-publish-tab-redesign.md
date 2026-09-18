# 派单模板「发布」屏重排 Implementation Plan

Goal: 把 release Tab 从"六件事平铺"重排为「状态 → 发布+校验 → 版本历史 → 折叠的更多操作」，并移除与本屏重复的文案预览。
Architecture: 只改 `template-manager-view.tsx` 的 release Tab 视图与其样式；复用既有 `collectDraftIssues`、既有发布/归档 mutation、既有版本查询，不新增后端能力。
Tech stack: Next.js 16 App Router + React 19 + Tailwind v4 + 商家端 `.mc-*` 样式层；Vitest 3.2（纯函数）；Playwright（E2E + 视觉快照）。
Spec: `docs/specs/派单模板发布设置-设计规格-v0.1.md`
Scope and non-goals: 范围内＝该 Tab 的结构、校验前置、版本行信息、危险操作折叠、移除文案预览、样式对齐。非目标＝后端、契约、版本机制、价格、其它 Tab。
Permission gates: 写仓库文件；启动本地服务跑 E2E；提交/推送/部署。
Completion evidence: typecheck 0、build 0、merchant-console 单测全绿、eslint/prettier 0、S3 E2E 3 passed（含新增断言）、快照基线更新。

## 1. 事实基线（已核实）

| 事实                 | 位置                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| release Tab 渲染分支 | `template-manager-view.tsx`（`{search.tab === "release" ? …}`）                      |
| 版本行标记           | 版本行带 `data-version-no`，含「恢复到此」「不可恢复」「加载更多版本」               |
| 发布动作             | 备注输入 `placeholder="例如：新增段位加价"` + `发布` 按钮；归档后保存/发布禁用       |
| 校验来源             | `collectDraftIssues(draft)`（`template-binding.ts`），返回项含 `componentKey` / 消息 |
| 危险动作             | 归档 / 取消归档 / 设为默认 / 删除 / 复制到游戏                                       |
| 文案预览             | 本屏存在「文案预览（按当前草稿）」；「渲染」弹层已有「订单文案」                     |

## 2. Task 1 结构重排

- [ ] 在 release Tab 顶部新增状态区：草稿/已发布、是否有未发布改动（复用现有状态计算，不新增请求）。
- [ ] 把发布区（溯源版本 + 备注 + 发布按钮）放在状态区之后，成为第二个视觉块。
- [ ] 版本历史保持在其后，标题右侧加一句「恢复是把旧版本写回草稿，线上不会变」，删除列表下方原说明。
- [ ] 归档 / 取消归档 / 设为默认 / 复制到游戏 / 删除 移入默认折叠的「更多操作」容器；删除用危险色。
- [ ] 保留既有交互与禁用条件不变（归档后保存/发布不可用）。

Focused verification: `corepack pnpm --filter @pw/admin-web typecheck` → 0。
Rollback: 恢复该文件的 release Tab 段落。

## 3. Task 2 校验前置

- [ ] 计算 `collectDraftIssues(draft)`，在发布按钮旁渲染：无问题时显示当前项数；有提示项显示琥珀色条目；有阻断项显示红色条目。
- [ ] 阻断项存在时禁用发布按钮（`disabled` + 说明原因），点击不产生请求。
- [ ] 不改变发布 mutation 的调用与参数。

Focused verification: 单测（若抽纯函数）+ typecheck；E2E 断言禁用态。
Rollback: 移除校验区，恢复按钮始终可点。

## 4. Task 3 版本行补操作人

- [ ] 版本行显示 `vN · 备注 · 时间 · 操作人`；操作人取现有数据源，取不到时显示空并保留原有信息，不伪造。
- [ ] `不可恢复` 与「恢复到此」逻辑不变。

Focused verification: E2E 版本行断言（含操作人）；typecheck。
Rollback: 去掉操作人字段。

## 5. Task 4 移除文案预览

- [ ] 删除 release Tab 里的「文案预览（按当前草稿）」块。
- [ ] 确认「渲染」弹层的「订单文案」仍可用（既有 S3 用例已覆盖渲染弹层）。

Focused verification: S3 E2E 中原本断言「文案预览（按当前草稿）」的语句改为断言渲染弹层的「订单文案」。
Rollback: 恢复该块。

## 6. Task 5 样式与门禁

- [ ] 按规格 P-8 用 `.mc-*` / `--mc-*` 对齐：块头 15px、说明 12px、按钮 32px、圆角 12px；不再使用 Tailwind 默认灰阶表达语义。
- [ ] 跑 typecheck / build / merchant-console 单测 / eslint / prettier。
- [ ] 跑 S3 E2E（`-g "S3 模板管理"`，**参数不能带竖线**），并按需用 `--update-snapshots` 更新基线。
- [ ] 更新 `docs/acceptance/2026-09-18-template-editor-primitive-redesign.md`（新增一节）。

## 7. 执行顺序

Task 1 → 2 → 3 → 4 → 5 串行（同一文件），每个 Task 结束报告改动文件、命令与退出码、未验证项。

## 8. 自检

- 规格 P-1 至 P-8 全部映射到 Task 1–5；非目标在 header 列出。
- 无 TBD；引用的文件、标记（`data-version-no`）、函数（`collectDraftIssues`）均在仓库中核实存在。
- 每个 Task 有聚焦验证与回滚；无步骤隐含安装、提交、推送、迁移或部署授权。
