# 未验证 / 待完成台账

用途：记录当前“未验证或未完成”的项与解除条件。条件满足后在对应切片完成，并在此更新（日期+证据）。

## A. 需第三方/账号/授权
| 项 | 状态日期 | 解除条件 |
|---|---|---|
| 微信小程序 weapp 真机/上线 | 2026-09-06 | 提供微信 AppID + 开发者工具 + 审核/发布授权（小程序开发暂缓） |
| mobile React 19 回归（现 React 18.3.1） | 2026-09-06 | Taro 上游支持 react@19 后独立升级任务 |
| 短信/企业微信通知、真实支付、AI Provider、生产对象存储 | 2026-09-06 | 到达对应切片并提供密钥/账号 |

## B. 需运行环境/后续切片
| 项 | 状态日期 | 解除条件 |
|---|---|---|
| H5 浏览器登录 E2E | 2026-09-06 | mobile H5 登录 UI 出现后执行（业务切片） |
| admin/mobile 运行态 E2E | 2026-09-06 | 运行中的 API + 真实域名；按验收以构建级为准 |
| 多实例登录限流（内存版单机） | 2026-09-06 | Slice 9 引入 Redis/BullMQ 后替换 |
| CSRF token 完整方案（当前 Origin/SameSite 校验） | 2026-09-06 | 认证完善切片 |
| CI 运行 integration/tenant-isolation（当前本地跑） | 2026-09-06 | CI 配置 PostgreSQL service（GitHub Actions）或外部库 |
| 平台角色独立凭据 + 审计（现 owner 连接串） | 2026-09-06 | Slice 11/平台切片 |
| Linux 容器化 + 应用 Dockerfile 验证 | 2026-09-06 | Slice 12 |

## C. 低优先级工程
| 项 | 状态日期 | 说明 |
|---|---|---|
| GitHub Actions actions（checkout/setup-node）Node20 注解 | 2026-09-06 | 升 v5 消除注解，非阻断 |
| npm CLI 本机缓存权限问题 | 2026-09-06 | 已用 pnpm（基线）替代，不阻塞 |

> 更新规则：每项完成时追加“完成日期 + 证据命令/退出码 + 责任切片”，不删除历史。
## D. Slice 3 剩余（2026-09-06 更新：Phase A+B 完成，剩余 UI/mobile）
- 完成：@pw/config-schema；tenant_config_versions/tenant_entitlements 迁移+RLS；tenant-config（版本化/回滚/CONFIG_ERROR 关闭）与 entitlements（core 常开、addon 默认关、门禁）API；契约测试（test:contract 3/3）。
- 剩余：admin 门店设置页（品牌 token/版本/回滚）、平台功能开关页；mobile runtime-config 品牌应用（运行态需 API+域名）
## E. Slice 3 收尾（2026-09-06）
- 完成（locally-verified，证据见 slice-3-acceptance.md）：
  - 公开 storefront-config 端点（host→品牌 token）；admin 平台/门店登录与鉴权接线（lib/api.ts）、套餐与功能开关页、门店设置页（品牌/版本/回滚/CONFIG_ERROR）；mobile runtime-config（H5 动态品牌 + CONFIG_ERROR 不可用，weapp typed unsupported）。
  - 修复：PermissionsGuard 生产 DI（改即时 Reflector）；CONFIG_ERROR 持久化（不回落默认值）与从 CONFIG_ERROR 回滚；H5 process 守卫；API 受控 CORS。
- 新增待办（解除条件）：
  | 项 | 状态日期 | 解除条件 |
  |---|---|---|
  | `pnpm db:seed:dev` root 脚本无法运行（根缺 @pw/database 链接） | 2026-09-06 | root package.json 增加 @pw/database workspace 依赖（或迁移脚本到有该依赖的包）后安装验证 |
  | Taro dev watch 缺 @pmmmwh/react-refresh-webpack-plugin | 2026-09-06 | 需要 watch 开发时补 devDependency（build:h5/weapp 不受影响） |
  | H5/品牌运行态需“已验证域名 + 同源反代/公网”拓扑 | 2026-09-06 | 提供真实域名并部署；本地已用静态+反代(:10086→:3100)验证 |
  | CI 不跑 integration/tenant-isolation（无 PostgreSQL service） | 2026-09-06 | GitHub Actions 增加 postgres service 或外部库 |
## F. 台账项闭环（2026-09-06，Slice 4 启动时核验）
- 完成（条件已满足，证据见下/CI）：`pnpm db:seed:dev` 修复（root package.json 增加 @pw/database workspace:*，pnpm install 后 `db:seed:dev` 退出 0：`seed ok`）；CI 增加 PostgreSQL service + migrate deploy + test:integration/test:tenant-isolation/test:contract（push 后由 GitHub Actions 验证）；actions/checkout@v5、actions/setup-node@v5。
- Slice 4 Phase A（数据模型）：迁移 `20260906000400_customers_catalog` 应用到 pw_saas/pw_saas_test（prisma migrate deploy 退出 0）；customer_profiles/player_profiles/games/game_regions/service_products/pricing_rules/player_skills/player_availability + RLS（FORCE）+ DB CHECK（price>0、cost>=0、duration>0、ends>starts）；tenant-isolation 13/13（新增 catalog.spec 4 项：SELECT 不可见/INSERT tenant_id=B 拒绝/UPDATE/DELETE 拒绝/本店合法写入可见）；typecheck 8/8、integration 32/32。
## G. Slice 4（2026-09-06，见 slice-4-acceptance.md）
- 完成：数据层 004/005 + RLS；customers/players/catalog API；全局 PermissionsGuard；admin 客户/陪玩/服务目录三页；陪玩账号绑定 + /tenant/player/me 自助；mobile player 页面注册（双端构建）。
- 新增待办：mobile 自助页真实数据接线依赖 H5 登录 UI（后端已就绪）；运行态公网域名 E2E。
## H. Slice 5 Phase A（2026-09-06）
- 迁移 `20260906000600_orders` 应用到开发/测试库：orders/order_requirements/order_price_snapshots/order_events/outbox_events/idempotency_records + OrderStatus + RLS；快照/事件不可变；line_total=unit*qty CHECK；幂等唯一(tenant,key,op)。
- tenant-isolation orders.spec 4 项 → 17/17；lint/typecheck 绿。
- 待办（Phase B 起）：订单状态机 DRAFT→CONFIRMED、价格快照生成、需求完整性校验、双入口（客服/客户自助）、时间线、Outbox 事件、H5 登录接线。
## I. Slice 5 收尾与未完成（2026-09-06）
- 完成：数据层006/007；订单 DRAFT→CONFIRMED 状态机+不可变价格快照+Outbox+幂等（integration 43/43）；admin /orders 页；客户档案-账号绑定；客户自助 me/下单/我的订单。
- 未完成（条件：后续 UI/登录批次）：mobile customer/order-create、customer/order-detail 页面 + H5 登录接线（同时闭环台账 B “H5 浏览器登录 E2E”）；admin 订单筛选/取消原因弹窗等体验。
- 条件核验：本轮无新增可直接闭环的旧项（微信/React19/支付/AI/真实域名/Redis/CSRF/平台凭据/容器化仍未满足，照常挂账）。

## J. Slice 6 Phase A（2026-09-06 启动）
- 见后续提交：派单/报名/指派数据模型迁移 008 + RLS + 隔离测试。
## K. Slice 6 Phase B（2026-09-06）
- 完成：派单 API publish/apply/shortlist/assign（原子指派行锁+唯一；并发仅一成功；指派后其余 EXPIRED、发布 CLOSED、订单 ASSIGNED）；陪玩 order-hall/apply/my applications；integration 45/45。
- 剩余（UI/登录批次）：admin /dispatch 页（发布/候选/指派 UI）；mobile order-hall/application-detail/candidates；派单撤回报名 WITHDRAWN 状态未做（记入待办）。
## L. Slice 6 Phase C/D + 四端 H5 登录（2026-09-06）
- 完成：老板（客户）自助候选/选人（dispatch customer controller + 归属校验，dispatch-concurrency 3 项）；mobile H5 登录接线（identity guard + session-store localStorage；weapp typed unsupported）；陪玩端 order-hall 报名、老板端 candidates 选 TA（build:h5/weapp 绿）。
- 台账 B “H5 浏览器登录 E2E”：本机 Playwright 真实跑通 商家→陪玩报名→老板选人→订单 ASSIGNED（s6-01..06 截图）；公网域名 E2E 仍挂账。
- 剩余：admin /dispatch 页（发布/候选/指派 UI 仍走 API/订单页）、派单撤回 WITHDRAWN、商家端订单页状态中文（ASSIGNED=已选定 待美化）。
## M. Slice 7 Phase A（2026-09-06）
- 迁移 `20260906000900_service_sessions`：service_sessions/session_events/session_adjustments/evidence_assets + SessionStatus/AdjustmentStatus + CHECK + RLS；isolation sessions.spec 2 → 22/22。
- 待办（Phase B/C）：场次状态机（SCHEDULED→STARTED→ENDED→CONFIRMED/ADJUSTMENT_PENDING，服务器权威时钟、幂等）、调整复核、证据上传（intent/内容 magic bytes/≤10MiB/授权下载；生产对象存储待台账 A）、H5/weapp media adapter 与 session 页。
## N. Slice 7 Phase B/C（2026-09-06）
- 完成：场次状态机（服务器时钟/幂等 start/end）+ 调整申请与复核（integration session-idempotency 3）；证据上传（magic bytes JPEG/PNG/WebP、≤10MiB、SHA-256、对象键、授权下载；本地 EVIDENCE_ROOT，生产对象存储待台账 A）→ integration 49/49。
- 剩余：H5/weapp media-adapter + 陪玩场次页（开始/结束/截图/调时长）+ admin /sessions 页（UI 后续统一重做）。
## O. Slice 8 Phase A（2026-09-06）
- 迁移 `20260906001000_ledger_settlements`：ledger_accounts/transactions/entries（只追加）、earnings、settlement_batches/items、manual_payment_records + 枚举/CHECK/RLS；isolation ledger.spec 1 → 23/23。
- 待办（Phase B）：订单核算生成 earning；平衡 ledger（借=贷拒绝不平衡）；结算批次 DRAFT→REVIEWED→APPROVED→PAID（线下记录/冲正/职责分离/并发唯一/开放争议阻止/已支付不可编辑）。UI（finance/admin、player earnings）后置。
## P. Slice 8 Phase B（2026-09-06）— 分成引擎
- 公式：platformFee=floor(amount*bp/10000), storeCut=floor(...), player=amount-fees（尾差归陪玩，守恒）。
- 可调：平台费率（platform/tenants/:id/finance-rules）、门店抽成（tenant/finance-rules/store-cut）；默认 3%/20%。
- unit 20/20（split 3）、integration 51/51（finance-rules 2）；迁移 011 已应用。
- 待办（Phase C）：订单核算生成 earning + 平衡 ledger（借=贷）、结算批次全流程、陪玩可提现余额展示（UI 后置）；老板余额钱包/在线支付属后续/Phase2。
## Q. Slice 8 Phase C-1（2026-09-06）— 订单核算
- 完成：POST orders/:id/accounting（生成 earning=playerShare≈77%，写入平衡 ledger：借客户应收=贷平台/门店/应付陪玩，幂等，订单→COMPLETED）；GET tenant/player/finance（pending/batched/paid 余额）。unit 20/20、integration 52/52。
- 待办（Phase C-2）：结算批次 DRAFT→REVIEWED→APPROVED→PAID(线下记录)/VOID、职责分离（发起人不得批准自己）、并发同一 earning 不可入双活批次、开放争议阻止（随 Slice9 disputes）；陪玩提现流程与 UI 后置。
## R. 简单 UI 首批（2026-09-06）
- 门店「财务」页 /finance：费率展示与调整（门店抽成）+ 分账试算（接入 finance-rules/store-cut/split-preview）；导航/首页加入 财务。截图 s8-finance-rules/preview。
- 原则：后续 UI 先做“简单可用”版本随功能走，美观后置；Slice 8 Phase C-2（结算批次）仍未开始。
## S. Slice 8 Phase C-2（2026-09-06）— 结算批次
- 完成：结算批次 list/create/add earning(行锁,仅 PENDING,不可双活)/review/approve(发起人不可批自己)/pay(线下记录→earning PAID)/void(退回 PENDING)；PAID 后不可改。
- unit 20/20、integration 54/54（settlement-concurrency 2）、lint/typecheck 绿。
- 待办：开放争议阻止结算（随 Slice9 disputes）、陪玩提现流程、财务 UI 完善（后置）。
## T. Slice 9 Phase A（2026-09-06）
- 迁移 `20260906001200_disputes_audit_notify`：disputes/dispute_events(OPEN/RESOLVED)、audit_logs(只追加)、notification_deliveries(重试)；RLS；isolation 24/24。
- 待办（Phase B/C）：争议状态机 + 结算 hold（开放争议 earning 不可结算，冻结用）、审计写入脱敏/查询权限（审计不可更新删除由只追加表+无 update API 保障）、Outbox relay/通知重试（BullMQ + worker + 短信/微信 degraded）、站内通知。UI 后置。