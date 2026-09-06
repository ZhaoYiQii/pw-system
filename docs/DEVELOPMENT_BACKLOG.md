# 开发待办清单（独立于台账）

- 创建日期：2026-09-07
- 来源：docs/unverified-and-deferred.md（台账未完成/挂账项）+ 完整代码审查报告（pw-system-code-review-report.md，P0/P1/P2 发现）
- 用途：作为“接下来一起开发”的工作清单；**不替代** unverified-and-deferred.md。
- 规则：只读审查已确认结论；实施仍遵守 AGENTS.md——一次只做一个切片、先失败测试、需要授权的动作单独确认。
- 状态图例：
  - `[ ]` 未开始
  - `[~]` 已批准/进行中
  - `[x]` 已完成（附日期+证据）
  - `[B]` 被阻塞（附阻塞原因）

> 完成时在同一行追加 `✅ 日期 | 证据命令/退出码`，不删除历史描述。

---

## 阶段 A｜安全与隔离收口（先做，收益最高）

### A1 越权修复：审计/通知/争议归属（建议第 1 个开发切片）
- [x] 描述：`/tenant/audit` 增加 `@Permissions("audit.view")`；通知列表按 actor 可见性过滤；争议 list/open 校验订单归属；open 去掉零 UUID 占位、支持“无 earning 客诉”。
- [ ] 来源：审查 P0-2、台账（审计脱敏/权限强化挂账）
- [x] 退出条件：HTTP 负例测试（PLAYER/CUSTOMER 读他人审计/通知/争议被拒；CUSTOMER 不能开他人订单争议）全绿。
- [ ] 涉及：audit/notifications/disputes controllers+services、tests/integration（新增 authz-http 负例）
- ✅ 2026-09-07 | 新增 tests/integration/authz-audit-notify-dispute.spec.ts；node vitest（integration）4/4 exit 0；dispute-freeze+outbox-recovery 相关回归 2/2 exit 0；API tsc exit 0；eslint 改动文件 exit 0。

### A2 租户会话生命周期：停用租户/账号撤销会话
- [x] 描述：login/refresh 校验 tenant.status=ACTIVE；deactivateTenant 与账号停用在事务内吊销 refresh session。
- [ ] 来源：审查 P0-3
- [x] 退出条件：新增“停用后登录 401 / 已发 token 刷新被拒”集成测试。
- ✅ 2026-09-07 | 新增 tests/integration/tenant-session-lifecycle.spec.ts；TenantAccountRecord 增加 tenantStatus，login/refresh 校验租户状态；deactivate 事务内吊销 refresh session；目标测试 1/1、全量 integration 20 文件/68 用例 exit 0；API tsc/eslint exit 0。

### A3 CSRF/会话加固
- [~] 描述：refresh token 只走 HttpOnly/Secure/SameSite cookie（不再在 JSON body 返回给 H5）；状态写接口补 Origin/Fetch Metadata/CSRF token。
- [ ] 来源：台账 B（CSRF 挂账）+ 审查 P0-1/P1
- [ ] 依赖：A2
- ✅ A3-Part1（2026-09-07）| login/refresh 响应不再含 refreshToken；refresh 仅接受 HttpOnly cookie；logout 改为 cookie 驱动；H5 identity adapter 使用 credentials=include；http-auth 5/5、lifecycle 1/1；全量 integration 20/68 exit 0；API/mobile tsc 与 eslint exit 0。
- [ ] 剩余（Part2）：CSRF token 双提交（写接口）、Fetch Metadata/Origin 全局门禁、前端自动 refresh 接线。

### A4 运行连接三分离 + 请求级 TenantContext
- [x] 描述：runtime（pw_runtime）/ platform / migration 三套凭据；所有租户业务 repository 以事务 GUC（withTenantContext）执行；新增 tenant context 中间件（host/会话为可信来源）。
- [ ] 来源：审查 P0-1
- [ ] 退出条件：租户隔离验收改为“应用 HTTP + pw_runtime”路径运行，全部 isolation 测试在该连接下通过。
- [ ] 风险：改动面最大，需单独拆分，建议 A1/A2 先合并本项后半段（HTTP 路径负例）。
- ✅ A4-Part1（2026-09-07）| 新增 common/database/tenant-guard.ts；customers/players/catalog 三模块连接切 pw_runtime，仓库经 tenantGuarded 事务 GUC 执行；tenancy 固定平台连接；integration config DATABASE_URL=pw_runtime（平台/迁移仍 pw）；CI env 同步；integration 20/68、isolation 25/25、tsc/eslint 全绿。
- ✅ A4-Part2（2026-09-07）| orders/dispatch/service-sessions/ledger/tenant-config/entitlements/ai/notifications/disputes 全部切 DATABASE_URL（pw_runtime）；仓库经 tenantGuarded 事务 GUC；ai/disputes/notifications 服务层显式 withTenantContext；tenant-guard 支持首参对象与嵌套 \ 同连接复用；integration 20/68、isolation 25/25、tsc/eslint 全绿。
- ✅ A4-Part3（2026-09-07）| auth 租户账号查询改 pw_runtime（先解析 code 再 GUC）；全局 TenantContextInterceptor（会话租户为可信来源，拒绝 body 异租户 tenantId）；.env.example 三套连接说明；新增 runtime-tenant-context.spec（无 GUC 默认拒绝/HTTP 跨店 404/伪造 tenantId 400）；integration 21/70、isolation 25/25、tsc/eslint 全绿。
- [ ] 移交项：currentTenantContext 接入日志/审计字段（E3/C2）；outbox relay 生产 worker 的租户/平台上下文（C3/C5）。

### A5 手机号加密 + 租户内查询哈希
- [ ] 描述：mobile 字段加密存储，另存租户内不可逆查询哈希；迁移保持向前兼容。
- [ ] 来源：规格 16.4；审查数据模型偏差
- [ ] 依赖：数据库迁移与 schema 修改需单独授权

---

## 阶段 B｜业务状态机与资金一致性

### B1 订单状态机完整化
- [x] 描述：按规格 10.1 补齐 CONFIRMED→DISPATCHING→ASSIGNED→READY→IN_PROGRESS→PENDING_CONFIRMATION→COMPLETED 与各可取消状态迁移；显式迁移表、事件+审计、409 无部分写入。
- [ ] 来源：审查 P1-4
- ✅ B2（2026-09-07）| 调整复核改店主/财务并禁止自审（409）；批准→CONFIRMED，拒绝→ENDED；核算完成将场次置 CONFIRMED+事件；integration 22/72、tsc/eslint 绿。剩余：真实超时自动确认调度、证据完整性门槛。
- ✅ B1-Part1（2026-09-07）| 新增 order-state-machine 迁移表；session start 推进 ASSIGNED→READY→IN_PROGRESS、end 推进 PENDING_CONFIRMATION；核算仅允许 PENDING_CONFIRMATION 且事件动态；取消集合扩展；integration 22/72、isolation 25、tsc/eslint 绿。
- ✅ B1-Part2（2026-09-07）| 客户确认完成 POST /tenant/customer/orders/:id/complete；客服/店主确认完成 POST /tenant/orders/:id/staff-confirm；取消时关闭发布+过期报名；状态机测试 2/2，integration 22/72、isolation 25/25、tsc/eslint 绿。
- [ ] 残余：真正的超时自动确认调度（当前为客服人工入口）；READY 确认 UI 拆分；场次证据完整性门槛（见 B2）；审计动作已由控制器写入 order.customer_confirm/staff_confirm。

### B2 场次状态机完整化
- [x] 描述：ENDED→CONFIRMED、ADJUSTMENT_PENDING→CONFIRMED 真实迁移；客户确认/超时确认；复核职责分离（申请人≠复核人，财务参与）。
- [ ] 来源：审查 P1-4
- ✅ B2（2026-09-07）| 调整复核改店主/财务并禁止自审（409）；批准→CONFIRMED，拒绝→ENDED；核算完成将场次置 CONFIRMED+事件；integration 22/72、tsc/eslint 绿。剩余：真实超时自动确认调度、证据完整性门槛。

### B3 金额端到端 bigint/十进制字符串
- [ ] 描述：repository 边界输出十进制字符串或 BigInt 值对象；API JSON 金额字段为字符串；domain 校验统一 Money 类型。
- [ ] 来源：审查 P1-6、ADR-008

### B4 结算与场次并发幂等加固
- [ ] 描述：settlement pay 批次行锁/条件更新防双付；session start/end 并发幂等（行锁/唯一约束+P2002 处理）。
- [ ] 来源：审查 P1-5/P2-16

### B5 账本不变量夜间校验
- [ ] 描述：全租户账本借=贷、earning 与 ledger 一致性定时校验与告警。
- [ ] 来源：规格 17.1

---

## 阶段 C｜审计 / 通知 / Outbox / Worker

### C1 审计写入覆盖全部关键操作
- [x] 描述：订单创建/确认/取消、派单、场次、证据、费率、结算、配置保存/回滚、登录失败统一写 AuditService。
- [ ] 来源：审查 P1-7
- ✅ 2026-09-07 | 新增 tests/integration/audit-coverage.spec.ts（3/3 exit 0）；回归 authz/orders/session/finance-rules/settlement/http-auth/config/onboarding/dispute 9 文件 30 用例 exit 0；为旧测试 afterAll 补充 auditLog 清理；API tsc exit 0；eslint 改动文件 exit 0。

### C2 审计脱敏与权限细化
- [ ] 描述：summary/PII 脱敏；平台支持跨租户只读的临时授权与审计原因。
- [ ] 来源：台账 U/V 挂账

### C3 Outbox relay 生产化
- [~] 描述：worker 定时消费；PROCESSING 超时回收；FAILED 死信+人工重放；崩溃注入测试；drain 需避免“全局取最旧 20 条”在测试/多租户下把本租户事件挤出批次（A1 实测发现）。
- [ ] 来源：审查 P1-5、台账 V/Y
- ✅ C3-Part1（2026-09-07）| relay 支持可选 tenantId 隔离；claim 写 PROCESSING 租约，超时自动回收；新增 requeueFailedOutboxEvent 人工重放；outbox-recovery 3/3；全量 integration 19 文件/67 用例 exit 0；API tsc/eslint exit 0。
- [ ] 剩余（Part2）：Worker/BullMQ 定时调度、自动退避与 dead-letter UI、崩溃注入用例入库。

### C4 通知模型用户化
- [ ] 描述：notification 增加 recipient 过滤/用户维度；站内通知 UI。
- [ ] 来源：审查 P0-2

### C5 Redis/BullMQ 与限流、队列
- [ ] 描述：多实例登录限流、BullMQ 通知任务、退避/死信。
- [ ] 来源：台账 B

---

## 阶段 D｜功能开关与订阅语义

### D1 Entitlements 门禁接入 API
- [ ] 描述：全局 EntitlementGuard，customer-self/order-hall/AI 等 addon API 按 featureKey 403。
- [ ] 来源：审查 P1-8

### D2 Entitlements 门禁接入 UI
- [ ] 描述：admin/mobile 菜单与路由由 `/tenant/features` 驱动；修正 packages 页“关闭后 API 403”文案。
- [ ] 来源：审查 P1-8

### D3 平台开通原子性与订阅生命周期
- [ ] 描述：onboarding 单事务（含套餐分配）；订阅唯一 ACTIVE；套餐到期/周期末变更规则；activate 完整性校验；开通配置走 config-schema。
- [ ] 来源：审查 P1-9

---

## 阶段 E｜契约 / 验证 / 可观测

### E1 OpenAPI + 生成客户端
- [ ] 描述：Nest Swagger、operationId、openapi.yaml、packages/api-client 生成、CI openapi:check。
- [ ] 来源：规格 12/19、审查 P2-11

### E2 Zod 输入校验 + RFC9457 错误结构
- [ ] 描述：全部 controller 入口 Zod Standard Schema；错误响应含 type/title/code/requestId/fieldErrors；未知字段拒绝。
- [ ] 来源：规格 12.1-12.2、审查 P2-12

### E3 requestId/结构化日志
- [ ] 描述：日志含 requestId/traceId/tenantId/actorId；禁止记录凭据与完整手机号。
- [ ] 来源：规格 17.1

### E4 健康检查与依赖探测
- [ ] 描述：/health 检查 DB/依赖连通；/ready 门禁。
- [ ] 来源：规格 19.3 运维行

### E5 覆盖率门槛
- [ ] 描述：vitest coverage（全仓 80%，状态机/金额/幂等 100% branch）失败即拒。
- [ ] 来源：规格 18.4

---

## 阶段 F｜验收命令 / CI / E2E

### F1 真实化根命令
- [ ] 描述：test:critical、test:e2e、db:migrate:check、db:seed:test 实现，去掉 not-implemented 占位。
- [ ] 来源：规格 19.1、审查 P2-17

### F2 Playwright E2E 入库
- [ ] 描述：客户/陪玩/客服/财务四条关键路径；语义定位器；无固定 sleep。
- [ ] 来源：规格 19.3

### F3 CI 完整门禁
- [ ] 描述：CI 增加 format:check、E2E、openapi:check、coverage。
- [ ] 来源：审查 P2-17

### F4 容量基线
- [ ] 描述：100 租户/100 万订单只读 100RPS、写 50RPS、P95 达标记录。
- [ ] 来源：规格 17.2

### F5 证据文件安全负例
- [ ] 描述：A 店 token 下载 B 店文件 404；伪装图片解码拒绝；跨租户引用负例。
- [ ] 来源：审查 P1-10

---

## 阶段 G｜前端与移动端

### G1 admin 补齐业务页
- [ ] 描述：结算批次、争议/审计/通知、AI、场次、订单详情/筛选、派单管理页。
- [ ] 来源：台账 I/K/N/O/P/U/V/Y 的 UI 后置

### G2 mobile 补齐客户页
- [ ] 描述：客户自助下单/订单详情；场次开始/结束/截图/调时长；收入；争议。
- [ ] 来源：台账 I/N/O/Y

### G3 mobile 平台适配收敛
- [ ] 描述：所有 fetch/location 移入 platform/h5；页面只依赖 contracts；ESLint no-restricted-*。
- [ ] 来源：审查 P2-14

### G4 admin 技术栈落地
- [ ] 描述：Tailwind/shadcn/TanStack Query/Table/Zustand/ui-tokens；路由与 feature flag 接线。
- [ ] 来源：规格 4.1/18.3

### G5 weapp 真适配
- [ ] 描述：identity/media/share/notification adapters；真机冒烟（需 AppID/授权）。
- [ ] 来源：台账 A

---

## 阶段 H｜Slice 12 发布候选与运维

- [ ] H1 Linux 容器化 + API/worker/admin Dockerfile 验证
- [ ] H2 备份/恢复/RPO/RTO 演练与 runbook（deploy/rollback/restore）
- [ ] H3 phase-1 acceptance 文档与四条关键路径 E2E 结论
- [ ] H4 审计脱敏、日志脱敏复查
- [ ] H5 真实域名部署验证（H5 品牌运行态 + 同源反代）

---

## 建议的执行顺序

1. **A1（越权修复）**：面最小、可直接验证、能立刻消除已确认的横向越权。
2. **C1（审计覆盖）**：与 A1 同属横切修复，改动模式一致。
3. **A2（会话吊销）**：登录/停用语义。
4. **A4（租户上下文）**：作为独立重构切片，需迁移+集成测试一起做。
5. 之后按 B（状态机）→ E（契约）→ D → C3/C5（Worker）→ G → H 推进。

> 每个阶段开始前：先定精确文件清单 → 建立失败测试 → 最小实现 → 本地/相关门禁证据 → 汇报后停下等确认（遵守 AGENTS.md）。
