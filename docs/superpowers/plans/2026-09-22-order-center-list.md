# 订单中心列表 Implementation Plan

Goal: 把商家端「订单中心」从「两路拉全量再本地拼」的读页面，升级为**按状态分页签的订单列表**：筛选、排序、分页、勾选批量、导出、行内动作与四态（空/加载/错误/无权限）都在服务端筛选之上成立。

Architecture: 列表读路径只有一条真源——`GET /api/v1/tenant/game-dispatch`（服务端负责筛选/排序/分页并返回 `total`）。前端把服务端行映射成 `dispatch-list-state.ts` 里已验证的纯逻辑行（状态计数 / 时间范围 / 关键字 / 排序 / 分页 / 勾选 / 批量汇总 / CSV 转义），页面只负责渲染与交互，不再自建过滤规则。写动作（发布、核定金额、释放名额、去结算、处置、报单审批）沿用既有端点，逐个 slice 接入。

Tech stack: Next.js（admin-web，Tailwind v4 token + `components/ui` + TanStack Query）、NestJS、Prisma 7、PostgreSQL 18、Vitest 3、Playwright。

Spec: 本文件。来源为用户 2026-09-21 拍板的产品口径 + 2026-09-22 批准的 Slice 0 收尾（提交 `c5e3dfc`）。设计规格缺位已在评审中标注；本文件即该口径的落地记录。

Scope and non-goals:

- **不做时间轴**：订单中心就是列表，按状态分割成页签，每个页签带计数。
- **不做**「排班管理（产能周视图）」（后置）。
- **不做**「模块级自定义授权」（单独立 ADR）。
- **不做**旧的 `.mc-*` 旧类清理：迁移到某页后，旧样式只有在确认无活动使用方时才作为独立清理任务删除（需 `rg` 验证无引用）。
- 不改后端 API、金额、权限、租户隔离与既有门禁；服务端筛选已在 Slice 0 收尾落地，本轮只消费。

## 已拍板的产品口径（不要改）

1. **列表筛选口径**：搜索、时间范围（今天 / 近 3 天 / 自定义）、多维筛选（游戏 / 陪玩 / 老板 / 金额区间）、排序、列设置、每页条数 + 分页、勾选 + 批量操作、空态/加载/错误/无权限四态。
   - 服务端参数（`c5e3dfc` 起生效，均为可选）：`status`、`limit`、`offset`、`from`、`to`、`sort`（`created_desc` 默认 / `created_asc` / `status`）、`gameId`、`playerId`、`customerProfileId`、`minAmountFen`、`maxAmountFen`。
   - 响应形状：`{ data: 行[], total }`，`total` 是**同一筛选条件下的总数**（不是当前页条数）；金额是整数分字符串，未选人时 `playerName` / `unitPriceFen` / `estimatedAmountFen` 为 `null`。
   - 金额区间作用于列表行已有的 `estimatedAmountFen`（整数分，含边界）。
2. **导出 = 按选中导出**，不是导出全部筛选结果。
3. **读权限 = 角色级**：老板给员工分配既有角色（`TENANT_ADMIN` / `CUSTOMER_SERVICE` / `FINANCE`）；列表端点沿用 `gameDispatch.manage` 权限，不带该权限的角色看到「无权限」态而不是空列表。
4. **金额口径**：一律整数分；平台费 = 0；结算按「单价 × 分钟 / 60 向上取整」。前端只展示，不参与计算。

## 项目约束（沿用仓库规则）

- 金额一律 bigint 分，禁止浮点。
- 每个租户资源必须在服务端绑定 `TenantContext`，禁止信任客户端提交的 `tenantId`。
- API 契约来自 OpenAPI，生成客户端不得手工修改。
- 新增/重写 admin 页面必须用新栈；**修改旧页面时一次性迁完**，不得同页混用旧类与新组件。
- 有可执行测试缝隙的行为先红后绿；每片先给证据再等提交批准。

## Slice 0（已完成，master）

- 纯逻辑 `dispatch-list-state.ts` + 单测（状态计数 / 时间范围 / 关键字 / 排序 / 分页 / 勾选 / 批量汇总 / CSV 转义）。
- `GET /api/v1/tenant/game-dispatch` 支持 `status`/`limit`/`offset` + `total`，去掉 `take: 100` 与 N+1。
- 列表行补齐 `customerName` / `playerName` / `unitPriceFen` / `estimatedAmountFen`，修正 `customerProfileId` 误填 `tenantId`。
- 支持 `sort=created_desc|created_asc|status` 与 `from`/`to`。
- `c5e3dfc`：补齐游戏 / 陪玩 / 老板 / 金额区间筛选，`total` 与筛选同步；契约用例钉死 `total` + 行字段 + 11 个查询参数；同步 openapi 与生成客户端。

## Slice 1：`dispatch-view.tsx` 整页迁到新栈并接上列表能力

### Slice 1 已拍板的四个实现决策（2026-09-22）

1. **数据源只走 `GET /api/v1/tenant/game-dispatch`**，页面 `h1` 保持「订单与派单」。
   - 原因：`GET /api/v1/tenant/orders` 只接受 `status` 一个参数，没有分页/时间/游戏/陪玩/金额筛选，权限还是另一个 `order.manage`；两路拼接时页签计数、分页与 `total` 只能对 GD 一路成立。现页面还存在**重复计数**：`Order` 全表与 `GameDispatchOrder` 底表重叠，同一张派单会同时以 CLASSIC 行和 GD 行出现两次。
   - **已知取舍**：本片之后 `CLASSIC` 订单（含 AI 录单入口建出的单）不再出现在该列表。若要统一订单台账，需另开一片给 `/tenant/orders` 补同类筛选参数，不在本片夹带。
2. **页签计数用同口径计数**：`全部` = 服务端 `total`（当前筛选条件下的权威总数）；9 个状态 = 当前数据集内 `statusCounts()` 分布。界面注明计数口径（「当前筛选内」），不做 10 次分状态请求。
3. **写动作边界**：本片只接「发布」「释放」「导出 CSV」「批量通过（逐条串行 + 失败汇总）」。
   - 发布的可用状态由服务端限定为 `DRAFT` / `CONFIRMED`，行级与批量按钮必须按状态置灰并给出原因提示。
   - 「核定 / 去结算 / 处置」与「批量释放」不接：涉及资金或争议状态机，各自另开一片；批量释放还缺列表行的 `slotId`。
   - 「证据差异徽章」本片不出真值（列表行没有申报时长与证据计时，逐行补请求不可接受），留到 Slice 2 审核台的真实三栏对照。
4. **分页 = 服务端首页 `limit=100` + 本地分页**：一次请求按当前筛选取最多 100 条，`total` 用服务端值，页码切换走本地 `paginate()`；超过 100 条时提示「结果太多，请收窄筛选」，不假装分页完整。真正的无限翻页需要后端稳定游标（`createdAt` + `orderId`），属于独立 API 片。

补充约定：列设置本片只做本地状态、不持久化；`?status=DRAFT` 深链行为保留（E2E 依赖），初始页签由 URL 决定。

允许修改的路径（越界即停下说明）：

- `apps/admin-web/app/_lib/merchant-console/dispatch-view.tsx`（整页重写）
- `apps/admin-web/app/_lib/merchant-console/dispatch-list-state.ts`（仅在需要新增纯逻辑时扩展，并补单测）
- 运行结论硬约束（E2E 依赖，不得破坏）：页面 `h1` 仍为「订单与派单」；表格仍有 `table tbody tr`；状态页签仍为 `role="tab"` 且 `?status=DRAFT` 时「待发布」页签 `aria-selected="true"`。

必须覆盖的交互落点：页签计数、时间范围（今天 / 近 3 天 / 全部）、排序、每页条数 + 分页、搜索、勾选 + 批量条（批量通过 / 释放 / 导出 CSV）、行内动作（通过 / 核定 / 释放 / 去结算 / 处置）、证据差异徽章、按陪玩分组 + 赶场提示、加载骨架、空/错误/无权限四态。

数据来源与已知缺口：

- 只走 `GET /api/v1/tenant/game-dispatch`；`apiFetch` 只解包 `data`，列表页需要拿到 `total`，因此本片要引入一个保留 `{data,total}` 的取数函数（不动 `apiFetch` 的既有调用方）。
- `merchant-api.ts` 里的 `DispatchRow` / `OrderRow` 是旧类型（缺新字段），迁移时以 `packages/api-client` 的生成类型为准，或在页面内定义局部行类型。
- 每页条数 + 分页：服务端 `total` 作为权威总数；是否逐页请求服务端由 `limit` 控制（默认 `20`，上限 `100`），前端只做页码与选中态管理。

验收证据：

- 纯逻辑新增/改动：对应 spec 先红后绿；
- `corepack pnpm --filter @pw/admin-web typecheck`、`lint`、`build`；
- `prettier --check` 涉及文件；
- 相关 Playwright 用例（订单中心部分）通过。

## Slice 2：独立模块「审核台」（后置，等 Slice 1 收口后单独批准）

记录台 → 审核台：三栏（队列 / 开始-结束截图并排对照 / 动作），把报单审批从场次详情收敛过来，沿用 `audit_logs` 留痕。

## 执行顺序与提交

- 顺序固定为 Slice 1 → Slice 2，每片独立评审、独立验收。
- 每片先红后绿、给证据，**提交与推送分别单独授权**。
- 本计划目前不含数据库迁移、不含部署、不含远端数据库操作。若某片需要迁移或回填（例如存量 v1 派单的 `gameId`），停止并单独申请。
