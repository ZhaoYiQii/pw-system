# ADR-0008：门店数据列表统一用 Tabulator 做「数据表格壳」

- 状态：**草案（待用户批准）**。用户 2026-09-23 选定 Tabulator，并要求"先写 ADR 再开始"、UI 定稿前给截图审核。
- 日期：2026-09-23
- 关联：ADR-0001（admin 前端新栈）、主规格（数据边界与租户隔离）、`apps/admin-web/app/_lib/merchant-console/modules.ts`（商家端模块注册表）

## 背景

- 门店侧数据列表会持续增加：支付台账、客户钱包、对账差异、结算批次、订单台账、客户档案、陪玩档案……现在每个页面都是"手写一遍 shadcn `Table` + 只读"。
- 用户明确的需求：**像 Excel 一样管理数据库里的数据**——复制粘贴、区域选择、查找、导出、行内编辑；而且**以后每个列表都套同一套**，不要每页重做。
- 现状缺口：没有排序/筛选（服务端）、没有列宽拖拽、没有区域选择与复制粘贴、没有导出、没有行内编辑；数据量大时也不能只靠一次拉全。

## 约束

1. **数据边界**：数据在 Postgres，租户隔离靠 RLS + `TenantScope`（ADR-0007）；前端**不得**直连数据库或写通用"任意表任意字段"接口。
2. **写入必须受控**：字段白名单 + 乐观锁（`version`）+ 审计（谁改的、改前改后），金额类字段禁止浮点。
3. **前端栈基线**（ADR-0001）：Tailwind v4 token + shadcn/ui 风格组件 + TanStack Query。引入新的 UI 框架属**技术栈变更**，必须先有本 ADR。
4. **依赖安装需用户单独授权**（AGENTS.md「必须单独取得授权的动作」）。
5. **门禁**：7 道（typecheck / typecheck:tests / lint / format / unit / integration / openapi）。
6. 已排除的候选（证据见下）：AG Grid（关键能力在企业版）、Handsontable（商用收费）、Glide Data Grid（不支持 React 19）、react-data-grid（beta）。

## 候选方案

| 方案 | 复制粘贴 | 区域选择 | 查找 | 导出 | 许可 / React 19 | 取舍 |
| --- | --- | --- | --- | --- | --- | --- |
| **A Tabulator**（选） | ✅ Clipboard 模块 | ✅ SelectRange 模块 | ⚠️ 无 Find 模块，用 Filter + 自建 Ctrl+F 高亮 | ✅ Download：csv/json/**xlsx**/pdf 内置 | MIT ✅ | 功能齐、无付费墙；代价：非 React 原生（命令式 API + 自带 CSS），需封装一次 |
| B Univer | ✅ | ✅ | ✅ find-replace | ❌ **xlsx 导入导出在 `@univerjs-pro/*`（付费）** | Apache-2.0 ✅ | 完整电子表格（公式/多 sheet），但超出"基础 Excel"需求，且导出要付费、整套画布 UI 与现有后台两种观感 |
| C TanStack Table 自建 | ❌ 要自写 | ❌ 要自写 | ❌ 要自写 | 部分（CSV 自写） | MIT ✅ | 与现有栈最同源，但剪贴板/区域选择/导出全要自研，工期与风险最高 |
| D RevoGrid | README 声称 ✅ | README 声称 ✅ | 未核到 | README 声称 xlsx ✅ | MIT ✅ | 周下载 2.4 万，知名度低于 A；站点有 "RevoGrid Pro"，**哪些能力属 Pro 未拿到权威说明**（文档页 JS 渲染抓不到），故不作首选 |

## 决定

1. 采用 **Tabulator（MIT）** 作为门店侧"数据表格壳"，并在 `apps/admin-web` 内封装成**唯一的** `<DataManager>` 组件；页面只写"列定义 + 资源名"，不再各页手写表格。
2. **写入一律走后端受控资源契约**（前端的表格能力只负责交互，不绕过权限与审计）：
   - `GET /api/v1/tenant/<resource>?page&pageSize&sort&filter&q` → 服务端分页/排序/筛选
   - `PATCH /api/v1/tenant/<resource>/:id` body `{ version, fields }` → 字段白名单 + 乐观锁 + 审计
   - `GET /api/v1/tenant/<resource>/export.csv` → 大表服务端流式导出
   - 新增/删除按资源另开（删除一律软删）
3. **样式不做第二套体系**：把 Tabulator 的 CSS 变量映射到现有 `--mc-*` / Tailwind token（一次性映射层），不引入第二套配色与圆角。
4. 集成方式：`next/dynamic(() => import(...), { ssr: false })`（Tabulator 直接操作 DOM）；**查找**用 Filter 即时筛选 + 自建 Ctrl+F 覆盖层高亮两条路径。
5. 分片推进：S5-1 表格壳 + 支付台账样板 → S5-2 行内编辑管线（示范：客户档案）→ S5-3 粘贴导入与导出增强。

## 理由

- 用户点名的四项能力**全部落在 Tabulator 的 MIT 免费包里**（见验证证据 2）：AG Grid 需要企业版才有的剪贴板、区域选择、Excel 导出，Tabulator 免费提供；而它的 xlsx 导出是内置实现（`downloaders/xlsx.js` 只 import 自己的 `CoreFeature`），不引入额外付费依赖。
- 与 Univer 的分工：Univer 是"整张电子表格"（公式、多 sheet、协作），本次需求是"**给数据库里的数据一个 Excel 级手感的列表**"，Tabulator 的边界更贴合；将来若真要做"门店自己搭公式表"，再按新需求另开 ADR 评估 Univer。
- 风险对冲：壳封在一个组件里，若 Tabulator 未来不合适（维护/观感），替换点只有一处，页面列定义可复用。

## 影响

- **前端**：新增依赖 `tabulator-tables`；新增 `apps/admin-web/app/_lib/data-grid/*`（壳 + 列定义类型 + token 映射）；新列表页从"写表格"变成"写列定义"。
- **后端**：每个要表格化的资源需要补"分页/排序/筛选 + 受控 PATCH + 导出"三件套（按资源逐个来，不做通用写接口）。
- **测试**：DOM 壳不写单测，改用 ① 纯函数单测覆盖列定义/校验/金额格式化，② Playwright 走查截图（含区域选择、粘贴校验、查找、导出），③ 7 道门禁。
- **观感一致性**：由 token 映射层保证；映射层出问题属于本 ADR 的回滚范围。
- 不改动任何现有页面契约与权限；当前各页保持可用。

## 迁移方式

1. 先支付台账（S5-1，样板 + 走查截图给用户审核）→ 客户钱包 → 对账差异 → 结算/订单/客户档案等存量列表逐步接入。
2. 迁移不得改变后端既有契约、金额、权限与租户隔离；每次迁移跑 admin typecheck/lint/build + 7 道门禁。

## 回滚方式

- 删除 `tabulator-tables` 依赖与 `app/_lib/data-grid/*`；页面回到现有 shadcn `Table` 实现（**本 ADR 不删除旧实现**，所以回滚是纯前端动作，不涉及数据与迁移）。
- 如仅观感不合，可只回滚 token 映射层。

## 验证证据

1. npm 元数据（2026-09-23 经本机代理只读查询）：`tabulator-tables` 6.5.3、`license=MIT`、周下载 136,644。
2. **免费包模块清单**（官方仓库 `tabulator-tables/tabulator` → `src/js/modules`，共 40 个）：含 `Clipboard`、`SelectRange`、`Export`、`Import`、`Download`、`Filter`、`Sort`、`ColumnCalcs`、`History`、`Keybindings`、`FrozenColumns/FrozenRows`、`Page`、`Validate`、`Spreadsheet`。
3. xlsx 内置：`src/js/modules/Download/defaults/downloaders/xlsx.js` 只 `import CoreFeature`，无外部商业依赖。
4. 对照排除证据：AG Grid 36.2.0 包 README 功能表显示 `Clipboard Operations`/`Range Selection`/`Excel Export`/`Find` 为 Enterprise（❌ Community）；Univer 的 Excel 导入导出为 `@univerjs-pro/exchange-client`、`@univerjs-pro/sheets-exchange-client`（Pro）；`@glideapps/glide-data-grid` 6.0.3 的 peer 仅到 React 18；`handsontable` 18.1.1 `license=SEE LICENSE IN LICENSE.txt`。
5. **未验证**：RevoGrid 免费/Pro 边界（文档页 JS 渲染，未取到权威说明）；Tabulator 的**键盘细节**与本仓库 React 19 运行时的实机表现（需装依赖后在样板页走查确认）。

## 批准记录

- 2026-09-23 用户口头选定 Tabulator 并要求"先写 ADR 再开始"、UI 定稿前给截图审核。
- **正式批准：待填**（本 ADR 批准前不安装依赖、不落地代码）。
