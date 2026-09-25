# 业务资金与陪玩结算系统实施计划

Goal: 在不引入通用 ERP 的前提下，将支付、钱包、退款、订单核算、陪玩结算和微信对账接入同一条可追溯资金链。

Architecture: 复用现有 `LedgerAccount`、`LedgerTransaction`、`LedgerEntry` 作为追加式账务骨架；新增资金账户、对账处理单和日结快照，并将业务原表作为来源事实。所有已确认资金事件以来源唯一键或幂等键生成平衡交易，前端只读取后端计算结果。

Tech stack: NestJS 12、Prisma/PostgreSQL/RLS、TypeScript strict、TanStack Query、Tailwind v4、现有 shadcn 风格组件、Tabulator 6.5.3。

Spec: `docs/superpowers/specs/2026-09-24-business-funds-and-player-settlement-design.md`

Scope and non-goals: 覆盖业务资金与陪玩结算；不实现税务、通用总账、发票或微信退款 API。保留现有支付服务商资金路径、金额口径和租户边界。

Permission gates: 数据库迁移在本地数据库执行前须取得单独确认；不安装依赖、不创建分支、不提交、不推送、不部署。任何真实微信、数据库云环境或支付渠道操作均需单独确认。

Completion evidence: 每个切片必须通过目标单测/集成测试、租户隔离测试、契约检查；涉及 admin 页面时通过 `pnpm --filter @pw/admin-web typecheck` 与 `build`。最终运行仓库的 lint、typecheck、critical/integration/tenant-isolation/contract、openapi:check、build 门禁并报告不可运行项。

## 项目约束

- 租户 ID 只从 `TenantContext` 获取；仓储必须走 `tenantGuarded` / `withTenantContext`，RLS 不得绕过。
- 金额使用分与 `BigInt`；接口输出金额为十进制字符串；不得用浮点数。
- 已确认账务交易只追加；更正写冲销交易；任何资金写操作都要事务、幂等和审计。
- 不修改用户现有未提交文件，除非它们属于本计划的确切路径且经当前切片确认。
- admin 新页面使用 Tailwind v4、现有 `components/ui/*`、TanStack Query、Tabulator 壳；不得引入第二套设计体系。

## Slice 1：账务来源关联与资金账户骨架

Objective: 让现有账务交易可以结构化关联业务来源与真实资金账户，并建立迁移安全网。

Files:

- Modify `packages/database/prisma/schema.prisma`：新增 `FundAccount`，扩展 `LedgerTransaction` / `LedgerEntry`，补唯一键、外键和索引。
- Create `packages/database/prisma/migrations/<timestamp>_business_funds_foundation/migration.sql`：新增表、枚举、约束、RLS 与 tenant policy。
- Create `apps/api/src/modules/ledger/domain/funds.ts`：事件类型、状态、科目代码、金额/借贷平衡纯函数。
- Create `apps/api/src/modules/ledger/domain/funds.spec.ts`：金额、平衡、同源唯一事件和冲销规则测试。
- Modify `apps/api/src/modules/ledger/infrastructure/prisma-ledger.repository.ts`：以稳定唯一编号替代 `Date.now()` 交易编号，并写入订单核算来源字段。
- Modify `apps/api/src/modules/ledger/ledger.module.ts`：注册资金账户仓储/服务。

Steps:

- [ ] 在改动前为现有 `completeAccounting` 写失败测试：同一毫秒的独立订单不会因交易号唯一键冲突；重复订单核算仍只返回原交易。
- [ ] 定义 `FundAccountKind`、`LedgerEventType` 与 `LedgerTransactionStatus`，并将它们纳入 Prisma 枚举与 API 内部类型。
- [ ] 为 `fund_accounts` 创建 `[tenantId, code]` 唯一键、RLS、最小字段校验；禁止存储完整银行卡号。
- [ ] 为 `ledger_transactions` 添加来源、事件、状态、资金账户、冲销关系和操作者字段；建立 `[tenantId, sourceType, sourceId, eventType]` 唯一键。
- [ ] 为 `ledger_entries` 添加可选资金账户及最小辅助核算字段；通过事务级纯函数拒绝不平衡、0 分和跨租户关联。
- [ ] 将订单自动核算交易标为 `ORDER_ACCOUNTING` / `CONFIRMED`，保留原有分账、订单状态和 Outbox 行为。
- [ ] 为迁移写回滚说明：仅删除新结构和代码路径，绝不删除已经写入的财务历史；正式执行迁移前单独请求授权。

Verification:

- [ ] `pnpm --filter @pw/api typecheck`
- [ ] `pnpm vitest run apps/api/src/modules/ledger/domain/funds.spec.ts apps/api/src/modules/ledger/domain/split.spec.ts`
- [ ] `pnpm db:migrate:check`
- [ ] 在具备本地 PostgreSQL 时运行对应租户隔离集成测试；没有 Docker/数据库时标记未验证。

## Slice 2：支付、退款与钱包接入统一交易

Objective: 使每一笔确认的客户充值和退款都能追到支付单、客户钱包、资金账户和统一交易。

Files:

- Modify `apps/api/src/modules/payments/application/payments-ports.ts` 与 `prisma-payments.repository.ts`：支付成功事务内写 `PAYMENT_CONFIRMED` 交易与钱包记录。
- Modify `apps/api/src/modules/payments/application/refund-ports.ts`、`manual-refund.service.ts`、`prisma-refund.repository.ts`：退款从“直接成功”改为登记/确认两阶段，确认时写 `REFUND_CONFIRMED` 或冲销交易。
- Modify `apps/api/src/modules/payments/interface/wechatpay-refund.controller.ts`：新增确认退款端点和幂等头/字段验证。
- Modify `apps/api/src/modules/payments/payments.module.ts` 与 `apps/api/src/modules/ledger/ledger.module.ts`：通过端口注入交易写入服务，避免 payments 直接依赖 Prisma 细节。
- Modify `apps/api/src/openapi/schemas.ts` 与关联 controller 注解：更新退款状态和确认契约。
- Modify `apps/admin-web/app/_lib/payments/payment-ledger-panel.tsx`：按后端状态展示“已登记/已确认/已对账”，不把登记显示成渠道成功。

Steps:

- [ ] 先写支付回调服务失败测试：同一个渠道交易号重放只产生一个钱包入账与一个 `PAYMENT_CONFIRMED` 交易。
- [ ] 先写退款失败测试：登记退款不创建确认分录；同一确认幂等键只创建一次确认交易；钱包余额与可退款上限保持不变量。
- [ ] 在支付成功现有事务内创建来源为 `PaymentOrder` 的平衡交易，并关联微信资金账户；资金账户未配置时显式失败或写入待配置异常，不静默落到未知账户。
- [ ] 将人工退款状态固定为 `REGISTERED`、`CONFIRMED`、`RECONCILED`、`CANCELLED`；补迁移与历史 `SUCCEEDED` 状态兼容映射。
- [ ] 增加 `POST /api/v1/tenant/payments/refunds/:id/confirm`，要求退款凭证说明、资金账户和幂等键；权限为 `finance.manage`，写审计。
- [ ] 为支付台账响应补交易 ID、资金账户、退款确认状态、对账状态；保留既有字段和 CSV 兼容列。
- [ ] 以 TanStack Query 失效规则刷新支付单、钱包和资金台账，不在前端猜测余额或退款结果。

Verification:

- [ ] 目标 payments 单测与新增退款/支付事务集成测试。
- [ ] `pnpm test:tenant-isolation`。
- [ ] `pnpm test:contract`、`pnpm openapi:check`。
- [ ] `pnpm --filter @pw/api typecheck`、`pnpm --filter @pw/admin-web typecheck`。

## Slice 3：结算实际付款与统一资金台账 API

Objective: 将“批准批次 → 实际付款”变成有资金账户、付款凭证、账务交易和可查询流水的闭环。

Files:

- Modify `packages/database/prisma/schema.prisma` 与迁移：扩展 `ManualPaymentRecord` 的资金账户、外部凭证、幂等键、确认时间；必要时增加与交易组的唯一关联。
- Modify `apps/api/src/modules/ledger/infrastructure/prisma-settlements.repository.ts`：付款事务内锁批次、写付款记录、写 `PLAYER_PAYOUT_CONFIRMED` 平衡交易、更新批次。
- Modify `apps/api/src/modules/ledger/interface/settlements.controller.ts`：将现有 `POST :id/pay` 迁移为带请求体的付款登记契约，保留过渡兼容策略。
- Create `apps/api/src/modules/ledger/application/fund-ledger.service.ts` 与 `infrastructure/prisma-fund-ledger.repository.ts`：统一台账筛选、排序、分页与 CSV 导出。
- Create `apps/api/src/modules/ledger/interface/tenant-fund-ledger.controller.ts`：`GET /api/v1/tenant/funds/ledger` 和导出端点。
- Modify `apps/admin-web/app/(tenant)/settlements/page.tsx`：付款动作收集资金账户和付款凭证，不再使用无信息的“登记线下支付”。
- Create `apps/admin-web/app/(tenant)/funds/ledger/page.tsx` 与 `_lib/funds/fund-ledger-panel.tsx`：Tabulator 服务端数据模式、组合筛选、导出当前视图。

Steps:

- [ ] 写失败测试：未提供资金账户、付款凭证或幂等键不能使 `APPROVED` 批次变 `PAID`；重复请求不会创建第二条付款记录或分录。
- [ ] 保留“创建人不能批准本人批次”和争议冻结规则；付款交易写入后才更新 earnings/slot earnings 为 `PAID` 与批次为 `PAID`。
- [ ] 实现统一台账查询白名单：时间范围、事件类型、资金账户、状态、来源类型、关键词、金额范围、排序字段、页码、页大小。
- [ ] 查询返回来源单据、资金账户、摘要、借贷方向、金额、确认状态、对账状态、操作者和发生时间；金额仍输出分字符串。
- [ ] CSV 使用与支付台账相同的公式注入防护和 UTF-8 BOM，导出参数与列表参数同源。
- [ ] 前端仅把服务器返回的筛选/排序映射到 Tabulator；选择列、列显示、保存视图留为独立 UI 切片，不能伪造后端保存成功。

Verification:

- [ ] settlement 状态机与付款交易集成测试。
- [ ] 统一资金台账的筛选、分页、导出、跨租户不可见、金额范围边界测试。
- [ ] `pnpm openapi:check`、`pnpm test:contract`、`pnpm test:integration`、`pnpm test:tenant-isolation`。
- [ ] `pnpm --filter @pw/admin-web typecheck` 与 `pnpm --filter @pw/admin-web build`。

## Slice 4：对账处理单与日结

Objective: 让差异从“看得见”进入可审计的处理闭环，并提供账户级日结快照。

Files:

- Modify `packages/database/prisma/schema.prisma` 与迁移：新增 `ReconciliationCase`、`DailyFundClose`、状态/唯一键/RLS。
- Modify `apps/api/src/modules/payments/application/tenant-reconciliation-*` 与仓储：保留差异事实，提供处理单查询。
- Create `apps/api/src/modules/ledger/application/daily-fund-close.service.ts` 与仓储：计算账户日结、检查未关闭差异、生成锁定快照。
- Create `apps/api/src/modules/payments/interface/tenant-reconciliation-case.controller.ts` 和 `apps/api/src/modules/ledger/interface/tenant-daily-close.controller.ts`。
- Modify `apps/admin-web/app/_lib/payments/reconciliation-panel.tsx`：提供认领、提交复核、关闭、忽略的真实状态操作与原因输入。
- Modify `apps/admin-web/app/(tenant)/finance/page.tsx`：替换“收入账本”定位为资金与结算总览，展示真实待处理差异和日结状态。

Steps:

- [ ] 写状态机测试：不能跳过认领/复核直接关闭；忽略与关闭均要求原因；关闭写入审计并同步差异解决时间。
- [ ] 写日结测试：存在开放处理单则拒绝关账；重复关账幂等返回同一快照；已关闭日期的写入被拒绝并要求反向更正交易。
- [ ] 对账处理单的每次状态变更写操作者、时间、说明、关联交易；服务端校验同租户资源与 `finance.manage`。
- [ ] 日结按资金账户汇总确认交易，计算期初、收入、支出、期末和差异数；不以 UI 汇总代替后端结果。
- [ ] 前端使用明确中文动作：“认领差异”“提交复核”“关闭差异”“忽略并说明原因”“执行日结并锁定当日账簿”。

Verification:

- [ ] 处理单状态机、日结计算、跨租户、审计和锁定集成测试。
- [ ] 对账页 E2E：认领 → 提交复核 → 关闭；无权限与错误态。
- [ ] `pnpm --filter @pw/admin-web typecheck`、`build` 与相关 Playwright 断言。

## Slice 5：资金总览、查询体验与历史回填

Objective: 将稳定的后端能力呈现为商家可用的资金工作台，并安全引入历史关联。

Files:

- Modify `apps/admin-web/app/(tenant)/finance/page.tsx`：接入资金总览、待办、日结状态，不保留静态财务数字。
- Modify `apps/admin-web/app/_lib/data-grid/data-manager.tsx`、`data-grid.css`：仅在统一资金台账所需范围内增加服务端筛选、列显示、金额与状态样式。
- Create 回填脚本 `scripts/backfill-business-fund-transactions.mjs`：仅在批准后执行，按来源唯一键可重复运行，输出未映射来源清单。
- Create 回填验证脚本 `scripts/verify-business-fund-ledger.mjs`：比较支付、退款、结算与新交易汇总，输出差异；只读。

Steps:

- [ ] 先写回填 dry-run 验证：不写数据库时输出待写入数量、重复来源、缺资金账户来源和金额汇总。
- [ ] 审核并取得对本地/目标数据库执行回填的单独授权后，才运行写入模式；目标、命令、影响和恢复方式须逐次确认。
- [ ] 总览所有金额由统一台账/资金账户后端聚合返回；不能把支付、钱包和结算页面的客户端数据相加。
- [ ] 为统一台账实现可访问的筛选器、键盘焦点、空态、错误态和无权限态；使用现有组件与 Tabulator 壳。
- [ ] 使用 Playwright 断言表头、行高、金额字体、圆角、阴影、hover 色并生成截图；不以截图代替 API/状态机测试。

Verification:

- [ ] 回填验证脚本 dry-run 输出与人工抽样来源一致；写入模式只在单独授权后运行。
- [ ] admin Playwright 关键路径、截图与计算样式断言。
- [ ] 完整门禁：`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test:critical`、`pnpm test:integration`、`pnpm test:tenant-isolation`、`pnpm test:contract`、`pnpm openapi:check`、`pnpm build`；无 Docker/凭证的集成项明确报告未验证。

## 任务顺序、恢复与交接

- Slice 1 是后续所有切片的前置条件；Slice 2 和 Slice 3 可在其稳定后并行设计，但实现时都依赖统一交易写入端口。
- Slice 4 依赖 Slice 2/3 的可查询确认交易；Slice 5 依赖全部后端契约稳定。
- 每个切片单独评审和验证；发现任何金额口径、租户隔离或状态机冲突时停止后续切片，回到设计而非继续堆功能。
- 恢复路径始终是停止新写路径、恢复旧读路径、保留已写不可变资金事实；不使用 `git reset --hard`、不删除资金记录。
