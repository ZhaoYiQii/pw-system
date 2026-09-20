# ADR-0004：档位（slot）链路按费率分账与平台费置 0

- 状态：**草稿（待批准）** —— 本 ADR 批准前不得进入实现；批准后按「迁移方式」落地，并单独切片、先红后绿。
- 日期：2026-09-21
- 关联：设计规格 `docs/specs/算价模型-设计规格-v0.1.md` §3.2 / §3.4 / §9；ADR-0003（算价模型）；Task 5b-2/A（费用口径只报真实数字）

## 背景（已核实的事实，2026-09-21）

规格 §3.2 的口径是：

```
订单金额（老板支出） = Σ(单价 × 核定分钟 / 60)
门店抽成             = 订单金额 × storeCutBp / 10000
陪玩实收             = 订单金额 − 门店抽成        // 平台费为 0，尾差归陪玩
门店毛利             = 订单金额 − 陪玩实收 = 门店抽成
```

但算价模型 Task 3/4 之后的实现里，**档位链路并没有分账**：

| 位置 | 现状 |
| --- | --- |
| `apps/api/src/modules/game-dispatch/application/game-dispatch.service.ts`（`reviewSlotReport` 审批通过分支，`slotEarning.upsert` 处） | 审批通过时 `amountFen = (单价 × 核定分钟 + 59) / 60`，即**整额**，未减平台费/门店抽成 |
| 同文件 `confirmSettlement` | 老板钱包按 `Σ amountFen` **整额**扣费，档位收入置 `SETTLED` |
| `apps/api/src/modules/ledger/infrastructure/prisma-settlements.repository.ts`（slot 档位入批次处，`amountFen: row?.amountFen`） | 结算批次给陪玩的金额 = `amountFen`（**整额发放**） |
| `apps/api/src/modules/ledger/infrastructure/prisma-ledger.repository.ts`（`splitSettlement` 唯一调用点） | 分账公式**只服务经典链路**的 `completeAccounting`；档位链路完全不写 `LedgerEntry` |
| `packages/database/prisma/schema.prisma`（`FinanceRateRule` 默认值）、`prisma-ledger.repository.ts`（`rates()` 兜底）、`apps/api/src/modules/platform-billing/platform-billing.service.ts`（onboarding 写入） | 平台费默认 **300bp**（规格 §9 要求本版**置 0**） |
| 本地一次性测试库 `pw_saas_s2_task2_20260916`（只读统计） | `finance_rate_rules` **0 行**、租户 54 个 → 现有租户全部在走代码兜底的 300 / 2000 |

**结论**：门店抽成在这条链路上既没有向老板多收、也没有从陪玩少发——**这条链路上门店不赚钱**，属于"规格已批准但功能未实现"。展示层（Task 5b-2/A）已按事实标注「未分账」，没有按公式编造毛利。

## 约束

- 金额一律 bigint 整数分、禁止浮点；尾差归陪玩（沿用 `splitSettlement`）。
- 历史金额不可回写：已产生的 `SlotEarning` 保持原口径，费率与规则变更只影响之后的分账。
- 租户隔离、幂等与并发语义不得放松（审批为行级 CAS，结算在事务内）。
- 「平台费置 0」是规格 §9 的既定决策，不在本 ADR 重新讨论"要不要收"；只决定**怎么落地**。

## 候选方案（分账载体）

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| **A（建议）** | 审批通过时即分账：`SlotEarning.amountFen` 改为**陪玩实收**，`detailJson` 保留 `grossFen / platformFeeFen / storeCutFen`；结算批次按实收金额入账 | 与规格公式一一对应；批次、陪玩收入、展示三处同源；回滚只改回旧公式 |
| B | 保留 `amountFen` 为整额，另建分账表或在批次侧扣减 | 对账要读两处，改动面更大，且容易出现"批次金额 ≠ 陪玩实收"的二次口径漂移 |

选 A。

## 待批准项（4 条，附建议）

1. **分账时机与载体 —— 建议 A**：审批通过即分账，`amountFen` = 实收（整额 − 平台费 − 门店抽成），明细进 `detailJson`。
2. **是否同时写账本分录 —— 建议 A（暂不引入）**：档位链路目前完全不写 `LedgerEntry`；门店抽成先落 `SlotEarning.detailJson` + 展示层，对账单独立项，避免"两套账本并行"。
3. **平台费置 0 的落地 —— 建议 A**：三处默认值改 0（schema 默认值、`rates()` 兜底、onboarding 写入），并加一条**幂等迁移**把既有租户的 `platform_fee_bp` 置 0。事实依据：测试库 54 个租户 0 行费率——只改代码不补数据时，"UI 显示的平台费率"与"实际参与计算的费率"会长期不一致。
4. **历史数据 —— 建议 A（不回写）**：切换点之前的 `SlotEarning` 保持整额，展示层标注「历史口径（未分账）」；切换之后按新口径。批量重算历史金额违反"快照不可回写"，不做。

## 影响面（按上述 4 条建议落地时）

- **金额与账本**：`SlotEarning.amountFen` 口径变化 → 陪玩收入（`prisma-ledger.repository.ts` 的 `pendingFen/settledFen`）、结算批次金额、门店毛利口径；老板支出（`confirmSettlement` 扣钱包金额）**不变**。
- **需要同步改的既有用例**（当前断言会红）：`tests/integration/finance-rules.spec.ts`（默认费率 300/2000）、`tests/integration/money-state-critical.spec.ts`（`splitSettlement` 契约）、`tests/integration/platform-ops.spec.ts`、`tests/integration/tenant-session-lifecycle.spec.ts`（夹具造 300bp）、`tests/integration/audit-coverage.spec.ts`（夹具造 400bp）。
- **展示层**：`apps/admin-web/app/(tenant)/game-dispatch/[orderId]/page.tsx` 的费用口径卡片从「未分账」变为真实的平台费 / 门店抽成 / 门店毛利；Task 5 建立的 E2E 视觉基线 `fees-summary-*.png` 需重生成。规格 §3.4 的三口径从"两个真数字 + 一处标注"变成三个真数字。

## 迁移方式（批准后按此实现）

1. 先写失败用例 `tests/integration/slot-settlement-split.spec.ts`：
   - 审批通过后 `amountFen = 整额 − 平台费 − 门店抽成`（含尾差归陪玩的取整断言）；
   - `detailJson` 保留 `grossFen / platformFeeFen / storeCutFen`；
   - 结算批次金额 = 陪玩实收；陪玩收入口径一致；
   - 平台费为 0 时 `实收 = 整额 − 门店抽成`；历史 `SlotEarning` 不变。
2. 改 `reviewSlotReport`：复用 `splitSettlement(grossFen, rates)`（费率取 `FinanceRateRule`，兜底 0 / 2000）。
3. 改三处默认值为 0，并加幂等迁移 `20260921xxxxxx_platform_fee_zero`（`INSERT ... SELECT ... ON CONFLICT (tenant_id) DO UPDATE SET platform_fee_bp = 0`）。
4. 更新受影响用例、费用口径文案与 E2E 基线。
5. 门禁：lint / typecheck / prettier / 单测 / 集成 / 租户隔离 / 契约 / `openapi:check` / 三端构建 + E2E（`--project=pricing-slot-report`）+ 走查复验。

## 回滚方式

- 代码回退：恢复旧公式 → 之后产生的金额回到整额口径（已产生数据不重算）。
- 数据回滚：迁移只改 `finance_rate_rules.platform_fee_bp`，可反向置回 300（幂等）。
- 展示层：卡片按 `splitApplied` 标记自动切回「未分账」文案。

## 验证证据（落地时补齐）

- 新集成用例与受影响用例的实际输出与退出码；
- 平台费置 0 迁移在本地一次性测试库的执行结果（迁移状态 + 费率行统计）；
- E2E `pricing-slot-report` 复跑与基线重生成记录；
- 全套门禁结果。

## 批准记录

- 待批准（2026-09-21 起草）。批准时请逐条确认上面 4 个待批准项，或指出需要调整的选项。
