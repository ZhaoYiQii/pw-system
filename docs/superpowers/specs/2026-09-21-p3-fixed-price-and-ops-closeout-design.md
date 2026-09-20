# P3 收口设计规格：固定价最小版 / 时长对照 / 违约台账 / 报名窗口统一

- 状态：**方向已批准**（用户 2026-09-21「按你的推荐」= D1=B、D2=B、D3=B、D4=A）；本文为写入版规格，待用户复核后进入实施计划。
- 日期：2026-09-21
- 关联：`docs/specs/算价模型-设计规格-v0.1.md`（§3.3 / §3.5 / §9）、ADR-0003（定价）、ADR-0004（档位分摊）、ADR-0005（状态机）、新增 **ADR-0006（固定价最小版）**

## 1. 已核实的前提（来自当前代码与规格）

1. 定价：`单价 = 底价(陪玩×游戏，缺省用兜底) + Σ 命中加价`；金额一律整数分；结算 `单价 × 申报分钟 / 60` **向上取整**（ADR-0003 / ADR-0004）。
2. 报单：**申报时长是计费依据**；开始/结束截图只作客服审批的人工核查材料。
3. `SlotReportView` **已经包含** `declaredDurationMinutes` 与 `durationSeconds`（证据计时），无需改后端契约。
4. 无人报名自动关单：`DISPATCH_NO_APPLICATION_TIMEOUT_MS` 默认 **5 分钟**（显式 0 = 关闭），由 worker 每 `OUTBOX_POLL_MS`（默认 5s）扫一次。
5. 报名窗口：`publish` 与 `releaseSlot` 里**硬编码 10 分钟**；能否报名取决于 `round.closesAt > now`。
6. 违约：`player_breach_records` + 记录/列表 API 已有（`POST orders/{orderId}/player-breaches`、`GET player-breaches?orderId&playerId&limit`，默认 50、上限 100，无时间范围与分页）；商家端目前只在订单详情页看/记。
7. 商家端导航是注册表驱动：`_lib/merchant-console/modules.ts`（id/group/label/kicker/description/features）+ `_lib/merchant-console/module-view.tsx`，路由由 `merchant-console/[module]` 解析。
8. `ORDER_CONFIRM_TIMEOUT_MS`（默认 15 分钟）只作用于冻结的 CLASSIC 订单，worker 已显式跳过 game-dispatch 订单。

## 2. 已批准的决策

| 编号 | 决策                                           | 子口径（本规格固定）                                                                                        |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| D1   | 固定价走**最小版**（选人时填写、覆盖单价快照） | 覆盖即最终单价（**跳过加价**）；**允许低于底价**，需二次确认 + 审计；不做规则库形态                         |
| D2   | 时长核验只做**只读对照展示**                   | 阈值 = Δ 绝对值 > max(10 分钟, 15% × 申报) 时着色提示；不做自动判定、不写库、不通知                         |
| D3   | 违约做**只读台账页**                           | 时间范围 / 陪玩 / 订单筛选 + `offset/limit` 分页；不做处置动作、**不做 CSV 导出**（进 backlog）             |
| D4   | 报名窗口与关单窗口**统一**                     | 新增 `DISPATCH_ROUND_WINDOW_MS`（默认 600000）；关单窗口默认取同值；`ORDER_CONFIRM_TIMEOUT_MS` 维持 15 分钟 |

## 3. 非目标

- 固定价不做规则库/批量预维护形态，不做跨游戏默认固定价。
- 时长核验不做自动标记列、不做「超阈值自动驳回」、不发通知。
- 违约不做撤销/申诉/封禁联动，不做 CSV 导出。
- 报名窗口/关单窗口不做门店级自助配置（保留 env 级配置）。
- 不动平台抽成（仍为 0 的公式不动）、不动 CLASSIC 冻结流程、不动结算公式与账本结构。

## 4. D1 固定价最小版（见 ADR-0006）

### 4.1 语义

- **谁填**：商家端（客服/店主）在**选人**时填；老板端自助选人**不接受**该字段（保持「老板不参与定价」）。
- **含义**：固定价即该档位**最终单价**（分/小时），**跳过**底价与加价计算；未填则维持现状。
- **落库**：写入既有 `order_slots.unit_price_fen` 快照（不改表结构）；展示口径不变（老板端/陪玩端看到的单价就是它）。
- **低于底价**：允许；前端二次确认，后端写审计 `from`（原算法单价）→ `to`（固定价）。
- **结算**：仍走 `单价 × 申报分钟 / 60` 向上取整（ADR-0003）；`SlotEarning.amountFen` 仍是陪玩实收（ADR-0004）。

### 4.2 契约

- `POST /api/v1/tenant/game-dispatch/orders/{orderId}/assignment` 请求体新增**可选** `fixedPrices: { applicationId: string; unitPriceFen: string }[]`（十进制字符串、整数分）。
- 响应形状不变（`DispatchView` 已含 `unitPriceFen`）。老板端端点 `POST .../customer/orders/{orderId}/assignment` 不变。
- 校验：非整数/带小数/负数 → **400**；`unitPriceFen` 不在 `1..1000000` 分（即 0.01–10000 元/小时）→ **400**（防手滑上限，属本规格选择）；`applicationId` 不属于该订单或状态非 `APPLIED` → **409**；`fixedPrices` 里出现**不在同一次 `applicationIds` 中**的报名 → **400**（不允许给没选中的报名定价）；未提供该数组 → 走原逻辑（底价 + 加价）。
- **老板端字段处理（明确）**：老板端端点 `POST .../customer/orders/{orderId}/assignment` 的请求体只读 `applicationIds`，多余的 `fixedPrices` 字段**被忽略且不报错**；契约用例需断言「老板端传入该字段不会改变档位单价」。
- **余额估算**：选人时的预估支出必须使用「固定价（若有）」，不足时仍按既有业务错误返回。
- **幂等**：同一 `applicationId` 重复提交同值视为幂等；改值覆盖并留审计（不新增档位行）。

### 4.3 权限与审计

- 写入需 `gameDispatch.manage`（商家端端点既有权限）；陪玩端不可写。
- 审计：`audit_logs.action = game_dispatch.slot_fixed_price`，`resource_id = slotId`，summary 含 `from → to`、理由（可选）。

### 4.4 验收

- 单测：固定价入参解析与边界（整数、0、上限、非数字）。
- 集成：填固定价后快照与视图单价一致；结算金额 = 固定价 × 分钟 / 60 向上取整；余额判定按固定价；低于底价被接受且审计含 from/to；越界 400；`fixedPrices` 含未选中报名 → 400；老板端传该字段被忽略（单价仍为算法价）。
- 契约：`openapi:check` 同步；契约用例断言新字段。
- E2E：商家端派单页填固定价 → 订单详情单价显示固定价（含视觉基线）。

## 5. D2 报单审批「时长对照」（只读）

### 5.1 语义

- 审批界面并排显示：申报时长、证据计时（`durationSeconds` → 分钟，向下取整展示但差值按秒算）、差值 `±Z 分钟`。
- 差值满足 Δ 绝对值 > max(10 分钟, 15% × 申报) → 高亮 + 文案「与证据计时差异较大，请重点核对开始/结束截图」。
- 证据计时缺失（`durationSeconds = null`）→ 显示「证据计时缺失」，不做颜色提示。
- **不参与**结算与审批结果；不写库、不发通知。

### 5.2 改动面

- 后端：无（字段已存在并已返回）。
- 前端： `apps/admin-web/app/_lib/merchant-console/` 增加纯函数 `durationGapTone(declaredMinutes, durationSeconds)`（可单测），并在报单审批视图（订单/场次详情的报单卡片）渲染对照区。

### 5.3 验收

- 单测：阈值边界（正好 10 分钟、正好 15%、缺失、零申报保护）。
- E2E：审批页显示对照与高亮态（含基线图）。
- 无契约变更。

## 6. D3 陪玩违约台账页

### 6.1 语义

- 新页面：商家端「陪玩违约」台账，按 `createdAt` 倒序；支持时间范围（`from`/`to`）、陪玩（`playerId`）、订单（`orderId`）筛选；`offset`/`limit` 分页（默认 20、上限 100）。
- 列表列：时间、陪玩、订单号（可点进订单详情）、原因、记录人。
- 只读：无撤销/申诉/封禁动作；不提供导出。

### 6.2 契约（`GET /api/v1/tenant/game-dispatch/player-breaches`）

- 新增可选 query：`from`、`to`（ISO 日期或日期时间；非法 → **400**）、`offset`（≥0，默认 0）、`limit`（1..100，默认 20；越界取上限）。
- 响应保持 `{ data: [...] }`（沿用现有数组契约）；`from > to` → 400。台账为倒序快照，翻页期间新增记录可能造成轻微漂移（在 operation 描述里写明）。

### 6.3 前端

- `modules.ts` 新增 module：`{ id: "breaches", group: "records", label: "陪玩违约", kicker: "RECORDS / BREACHES", description: "陪玩放鸽子/未到场的违约台账，供点名与对账。", features: ["时间/陪玩/订单筛选", "分页台账", "点进订单详情"] }`。
- `module-view.tsx` 增加该 module 的视图分支（TanStack Query + 现有表格/分页组件，遵循新栈约定）。

### 6.4 验收

- 集成：筛选（时间范围/陪玩/订单）、分页边界（offset 超界返回空数组）、非法日期 400、租户隔离（他店记录不可见）。
- 契约：新 query 参数进 openapi。
- E2E：台账页筛选 + 分页 + 视觉基线。

## 7. D4 报名窗口统一（行为变更）

### 7.1 语义与配置

- 新增单一来源 `DISPATCH_ROUND_WINDOW_MS`：默认 `600000`（10 分钟），允许范围 `60000..7200000`（1–120 分钟）；非法/越界回退默认并在启动日志 `warn`。
- `publish` 与 `releaseSlot` 创建轮次时使用该值（消除两处硬编码 10 分钟）。
- 无人报名关单窗口 `DISPATCH_NO_APPLICATION_TIMEOUT_MS`：**未显式配置时默认取 `DISPATCH_ROUND_WINDOW_MS`**；显式 `0` 仍表示关闭该规则。
- `ORDER_CONFIRM_TIMEOUT_MS` 保持 15 分钟（只影响 CLASSIC）。
- **行为变更（需写进发布说明）**：默认关单窗口由 5 分钟变为 10 分钟；报名窗口从硬编码 10 分钟变为可配置。

### 7.2 实现位置

- 新增 `apps/api/src/modules/game-dispatch/domain/dispatch-window.ts`：`DEFAULT_ROUND_WINDOW_MS`、`resolveRoundWindowMs(env)`、`resolveNoApplicationTimeoutMs(env)`（纯函数，便于单测）。
- `game-dispatch.service.ts` 两处轮次创建改用解析结果；`apps/api/src/background/bootstrap.ts` 的关单窗口默认值取同一函数。
- 配置模板：`infra/docker/docker-compose.prod.yml`（api/worker/pw-init 传 `DISPATCH_ROUND_WINDOW_MS`）、`infra/docker/env.prod.example`、`.env.example`。

### 7.3 验收

- 单测：解析函数（缺省、合法、越界回退、0 语义、非数字）。
- 集成：窗口内可报名；窗口外报名 409；无人报名在（注入的短）窗口后被关单并写 `order_events`（system actor）+ 审计 + Outbox。
- 无契约变更（配置项不入 openapi）。

## 8. 实施顺序（4 个 Slice，每片单独提交）

| Slice | 内容            | 风险       | 备注                                      |
| ----- | --------------- | ---------- | ----------------------------------------- |
| 1     | D4 报名窗口统一 | 低         | 先消除口径冲突；含一处行为变更            |
| 2     | D2 时长对照展示 | 低         | 纯前端 + 纯函数单测                       |
| 3     | D3 违约台账页   | 低-中      | 后端加筛选/分页 + 新页面                  |
| 4     | D1 固定价最小版 | 中（动钱） | **ADR-0006 先行**；独立用例覆盖结算与审计 |

每片门禁：`lint` / `typecheck` / `prettier --check` / 单测 / 集成 / 租户隔离 / 契约 / `openapi:check` / 三端构建；涉及 UI 时补对应 E2E project。

## 9. 回滚

- D4：回退代码并移除新 env（自动回到 5 分钟）；无数据影响。
- D2：回退前端组件；无数据影响。
- D3：回退前后端；只读功能，无数据影响。
- D1：回退代码即可；已写入的固定价快照保留在 `order_slots.unit_price_fen`（属历史事实，无需清洗；回退后新单不再接受该字段）。
