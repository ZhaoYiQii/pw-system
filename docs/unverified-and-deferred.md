# 台账（校对版 · 2026-09-11）

- 用途：记录当前“未验证 / 未完成 / 仍挂起”的项与解除条件。
- 校对日期：2026-09-11；与 `docs/DEVELOPMENT_BACKLOG.md`（校对版）使用同一状态口径。
- 证据基准：`master` @ `836b8b1`（基准 commit 于 2026-09-22 复核，条目内容仍为 2026-09-11 校对）；历史切片明细回查 git log `cce1ca0..3692450`。
- 范围决策备注：Redis 共享限流 + DB Outbox 已覆盖队列语义，按 2026-09-07 记录不引入 BullMQ；weapp 开发暂缓（等主程序完成后处理）。

## A. 需第三方 / 账号 / 授权（仍挂起）

| 项                                               | 状态日期   | 解除条件                                                                 |
| ------------------------------------------------ | ---------- | ------------------------------------------------------------------------ |
| 微信小程序 weapp 真机/审核/发布                  | 2026-09-11 | 提供微信 AppID + 开发者工具 + 审核/发布授权；用户已决定主程序完成后处理  |
| 微信一键登录（手机验证码登录 P1 已完成）         | 2026-09-11 | 提供微信开放平台 AppID/AppSecret 与回调域名                              |
| 线上支付（钱包充值真实渠道）                     | 2026-09-11 | 商户号/密钥；当前为本地模拟支付，先保持“可插拔支付模块”                  |
| 短信通道 / 微信通知 / AI Provider / 生产对象存储 | 2026-09-11 | 到达对应切片并提供密钥/账号                                              |
| 生产 `PII_MASTER_KEY`                            | 2026-09-11 | 部署时生成并备份（开发环境用 `SESSION_SECRET` 派生，生产强制独立主密钥） |
| mobile React 19 回归（现 React 18.3.1）          | 2026-09-11 | Taro 上游支持 react@19 后独立升级任务                                    |

## B. 需真实运行环境 / 发布阶段（仍挂起）

| 项                                                         | 状态日期   | 解除条件                                                                                    |
| ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| H1 Linux 容器实机验证（Dockerfile 与 prod compose 已就绪） | 2026-09-11 | 提供 Linux 主机/服务器后实机跑通迁移、seed 与三端启动（api / admin-web / H5；weapp 未开工） |
| 备份/恢复/RPO/RTO 演练与 runbook                           | 2026-09-11 | 发布阶段                                                                                    |
| phase-1 acceptance 文档与四条关键路径 E2E 结论             | 2026-09-11 | E2E 接入 CI 后执行                                                                          |
| 审计/日志脱敏上线前复查（运行时）                          | 2026-09-11 | 部署前复查跨租户授权与运行时日志                                                            |
| H5 品牌运行态 + 同源反代/公网部署（含 H5 首页域名定位）    | 2026-09-11 | 真实域名并部署；本地无 `tenant_domains` 映射                                                |
| 统一访问入口 + 设备自动跳转（H6）                          | 2026-09-11 | 正式域名部署期实现：手机/微信内 → H5 角色端，电脑 → 管理后台/桌面版                         |

## C. 工程与体验收尾（本地可继续开发）

- （2026-09-26 Bug 修复轮新登记）本轮修复过程发现的残留项：
  - **契约缺口**：`POST /api/v1/auth/switch-context` 的错误语义（未持有目标端角色 403 / 会话不可继续 401 / 非法 context 400）**不在 OpenAPI 文档里**——该控制器方法没有 `@ApiResponse` 装饰器，错误码只存在于代码与集成测试中，`pnpm openapi:check` 对此零覆盖（本轮已跑 `openapi:generate`，生成物零 diff）。补法：给该端点补错误响应注解后再生成。
  - **本地 API 多实例 + 日志路径靠人记**：端口 3001 上仍挂着 2026-09-26 06:24 启动的旧实例（PID 19548，`work/api-run.out.log` 是它的日志），实测用的 3300 此前没有独立日志文件，其 `work/api-run.err.log` 长期 0 字节——全局过滤器 `HttpErrorFilter` 的 `logger.error`（含 500 堆栈）事实上无处可查，本轮排查 switch-context 500 只能靠代码推导。现 3300 已改写到 `work/api-3300.out.log`，但结构问题（谁启动、日志去哪）未解决。
  - **PII 密钥漂移**：`GET /tenant/customers` 与 `/tenant/players` 共 13 行手机号密文无法用当前密钥解密（`tryDecryptPhone` 降级并打告警，列表显示「未绑定」）。口径已定：**保留密文、不回填、不置空**，展示为「待重新绑定」；重新绑定走手机号绑定流程。
  - **Taro H5 禁用态颜色（Bug 1 根因，已定位到属性选择器）**：Taro 对每个 `taro-button-core[disabled]` 强制 `color: rgba(255, 255, 255, .6)`，而 `[disabled]` 是**属性存在性**匹配——`disabled={false}` 同样命中（实测按钮 DOM 上是 `disabled="false"`），于是任何传了 `disabled` 属性的浅色底按钮都成了白字白底，肉眼即「按钮没有名称」。本轮修复用 `:not(.cu-button-primary):not(.cu-button-dark):not(.cu-button-green)`（player-ui 同理）限定，只覆盖浅色底 soft / plain 按钮，深色底按钮保留原禁用视觉；`.cu-button.is-disabled` 类名样式未动。**其他页面新增按钮组件会踩同一陷阱，需自查。**
  - **`pw-button[disabled]` 常暗**：`.pw-button[disabled]{opacity: .48}` 让真禁用按钮在浅色卡片上对比度偏低；本轮只解决「白字不可见」，禁用态的整体可读性评估待做。
  - **旧 token 静默降级**：`PermissionsGuard` 对不带 `roles` claim 的 token 回退 `[role]`，无法与「真正的单角色账号」区分；token 过期后该回退自然消失。
  - **管理端拒绝无反馈 / 批准无 toast**：商家端处理陪玩申请时，批准与拒绝都只有列表刷新，没有成功提示。
  - **`PlayerLoginCard` 脚注过时**：仍写「微信与验证码登录将在平台能力接入后开放」，而手机验证码登录（P1）已于 2026-09-10 完成。
  - **对 `player` / `service` 账号显示「需要客户身份」**：老板端页面复用了同一条提示，非客户账号打开时文案误导。
  - **`tests/e2e/mobile.spec.ts` 缺多角色夹具**：移动端 E2E 只用纯 `player` 账号，「多角色账号进入陪玩端要切端上下文」这条修复路径没有 E2E 覆盖（仅有集成测试与手工 CDP 取证）。
  - **切端后的会话范围是设计决定（待产品确认）**：`features/player-context/actions.ts` 切来的陪玩 token **不写回 session**（避免老板端页面被陪玩上下文污染），所以「切到陪玩端」只对当前页面生效；若产品要全局切换（进陪玩端后老板端页面也用陪玩 token），需一次显式决策。
- （2026-09-26 SP1）多角色授权解析修复已交付，三个遗留项均已登记在 spec §12：①**陪玩端入口显隐未接线**——F9 要求「有陪玩申请才出现陪玩端入口」，v1 的 H5 首页仍是两个并列入口（`openPlayer` / `openBoss`）；SP2 的前端环节**未**新增申请状态查询，故维持原状（入口常显、点进去由接口 403 兜底）。②**端上下文判别字段仍是单值**（约 60 处 `principal.role !== "PLAYER"` 式判端，6 个 `dispatch.manage` 端点全含），SP1 只修了权限层；「同一会话内跨端操作」需另立 ADR。③**改密后不撤销其他 refresh 会话**（有意不做，SP2 的 `POST /api/v1/auth/password` 亦维持：只更新 `password_hash` / `password_set_by_user`），完整做法需新增「按账号撤销全部 refresh 会话」仓储方法（非 schema 变更）。
- （2026-09-26 SP2 新增登记）`phone-login` 对停用门店的**既有**缺陷：`phoneCustomerLogin`（`auth.service.ts:242-253`）在账号不存在时先建号、之后才判门店状态并抛 `TenantInactiveError`，而 `phone-login` 控制器（`auth.controller.ts:228`）未捕获该错误（对照 `login` 控制器在 `:172` 捕获并转 401）⇒ 落到全局过滤器返回 **500**，且停用门店被建出账号。本轮不修（不属本 slice）；SP2 的 `register` 不复制该缺陷（门店状态在建号前判定，返回 403）。另登记：`player-applications` 的「一人一申请」并发窗口（既有实现，未碰）。
- （2026-09-26 SP2）**人工实测缺口**：SP2/SP1 的页面链路（注册 → 可选手机号绑定 → 首次设密码免验原密码 → 改密必验 → 勾「我是陪玩」提交申请 → 老板批准 → 同一 token 双端可用）**只经过自动化门禁与 API 级 curl 验证，尚无人手工点过页面**。本地已起服务供实测：API `http://127.0.0.1:3300`（`/health` 200）、H5 `http://127.0.0.1:3101`（`/api` 反代到 3300，经其登录返回 201 已验证）、admin-web `http://127.0.0.1:3100`（须带 `NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3300`）；演示账号 `owner` / `player` / `customer` / `service`（门店码 `demo`）与平台端 `admin`，密码均 `zcloud1024`。已知本地限制：MinIO 无 bucket（证据上传必失败）、短信为 mock（验证码直接显示在注册页）、微信登录未启用。

- （2026-09-27 Bug 2 方案轮新登记 / 同日第一批实施后更新）大区 / 目标段位 / 模式的必填与联想：**ADR 已批准，第一批已实施，第二批未授权**——`docs/adr/0010-order-region-rank-mode-presets.md`（2026-09-27 **已批准**）。三处方案分歧点已由用户确认（按基础价 + 下单页提示 / 必填卡模板发布口不追溯存量 / **分两批实施**）；第一批实施计划 = `docs/superpowers/plans/2026-09-27-order-field-free-input-batch1.md`（**2026-09-27 已实施并验证**，记录见 ADR-0010「实施记录（第一批）」）。登记四项：① **用例覆盖**——前缀联想（`翡1` → 翡翠1）与「三字段必填」这条业务约束**仍无任何自动化用例**（属第二批）；「库外值不阻塞提交」第一批已补（api 2 条 + mobile 2 条 + 集成 1 条）。~~既有断言正好固定在待豁免的旧行为上，实施时需收窄而非删除~~ —— **2026-09-27 复核后更正**：该判断**不成立**。两处既有断言（`apps/mobile/src/features/customer-ui/order-values.spec.ts:124-135` 的「模式 的值不在模板选项中」、`apps/api/src/modules/game-dispatch/domain/game-template-values.spec.ts:61`）用的夹具字段**都没有 `semanticRole`**（mobile 夹具 `:25-38`、api 夹具 `:23-31`，只有 fieldKey/label/fieldType/required/enabled/sectionId/options），不是豁免角色 ⇒ 本批改动**不会**让它们转红，**不需要收窄、也不应改动**；它们反而是「豁免没写宽」的护栏（若实施后转红，说明豁免判定误把未标注字段也放行，须修实现）。**2026-09-27 实施后二次更正**：由上述两条推出的「既有断言一律不需要收窄」**不成立**——另有 **3 条**断言挂在**真正的豁免角色夹具**上，实施时确实转红，已按「把"未知选项被拒"的覆盖改挂到未豁免的 `CUSTOM` 字段」收窄（`apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts` 的 `target_rank: "unknown"` 与 `mode: "unknown"`、`apps/api/src/modules/game-dispatch/domain/game-template-order-draft.spec.ts:215` 的 `mode: "not-declared"`），**无删除**；上一条结论对**它自己点名的两处**仍然成立（那两处确实未转红、原样保留为护栏）。② **平台预设库需一次建表迁移**（`platform_game_presets`，唯一键 `[gameId, kind, value]`）：平台端此前对该能力**零基础**（`app/(platform)` 整目录对 rank/region/mode/template 零命中、导航仅 8 项），故必须新建表 + 新接口 + 新页面；迁移按 AGENTS.md 需**单独授权**。③ **需先修订产品裁定 D-13**（`docs/specs/派单模板表单设计器-设计规格-v0.2.md:16`「只给原语，不给预设」）的适用边界——为 `SERVER_REGION`/`TARGET_RANK`/`MODE` 三个语义角色开例外，否则商家在模板设计器里无法标注这三个字段，「必填由模板发布口保证」的方案无法落地。④ **人工实测缺口**：第一批**只有自动化门禁与集成用例证据，页面链路尚无人手工点过**（按用户授权原文「页面人工实测另起服务时再单独报」）；待验观感 = 豁免字段「预设按钮 + 自由文本输入」并存的布局与「，可填写预设外的值；不在预设库中不影响提交，将按基础价。」提示文案的位置与可读性。
- （2026-09-27 第一批实施中新登记的三处口径缺口）
  - **v1 经典链路实际仍拦库外值（语义角色在 v1 不可达）**：v1 建模板路由有**严格 Zod 请求校验**，带 `semanticRole` 的 payload 实测返回 **400** `{"code":"ApiValidationError","fieldErrors":{"fields":["Unrecognized key: \"semanticRole\""]}}`；即便放行，`apps/api/src/modules/game-dispatch/application/game-template.service.ts:64-113` 的 `cleanFields` 逐键构造返回对象时**从不读该键**、`infrastructure/prisma-game-template.repository.ts:140-155` 的 `createMany` **不写该列** ⇒ v1 字段恒为 DB 默认 `CUSTOM`（`packages/database/prisma/schema.prisma:1157`）。**结果**：第一批在 `game-template-values.ts` 里对 v1 的豁免**在现有产品链路不可达**（属前瞻性保留），老板端 v2 不可用自动回退 v1 后库外值仍被 400 拦下——即 ADR-0010 决定一「两条链路都要改」目前只在 v2 成立。**出路待用户决策**：(a) 扩展 v1 契约（OpenAPI/Zod + repository 写列 + 重新生成客户端，属契约变更需另行授权）；(b) 保留前瞻性代码、按已知限制接受；(c) 回退第一批的 v1 改动。**未写**「v1 仍拒库外值」的护栏测试——那会把限制固化成预期行为，与 ADR 意图矛盾。
  - **移动端表格 `SINGLE_SELECT` 列不豁免（跨端口径不一致）**：`apps/mobile/src/features/customer-ui/order-values.ts:360-364` 的 `convertCellValue` 对列传 `allowFreeValue = false`（封闭预检），而服务端**文案侧已放行**——`game-template-document.ts:96-99` 对列传 `allowsFreeInput(column)`；算价侧本就不覆盖列（`game-template-calculations.ts:402-410` 的 `templatePricingDimensionFields` 只取 `FIELD` 组件）。⇒ 若模板把某列标成豁免角色且老板填库外值，**服务端能接受、移动端会先拦下不发请求**。（该差异已在代码注释中声明并指向本台账。）影响面待核：模板设计器是否允许给列标语义角色尚未核实，与第二批一并处理。
  - **admin-web 存在同一规则的第三份实现**：`apps/admin-web/app/_lib/merchant-console/template-document-preview.ts:92` 自带 `${source.label}的值不在模板选项中` 判断，**未随本批豁免** ⇒ 商家端预览会对服务端已接受的库外值报错（预览文案与服务端口径不一致）。第一批未改（越界 admin-web），登记待处理。
- （2026-09-26 SP2 前置，**已执行**）`tenant_accounts` 新增 `password_set_by_user`：为使「初次设置免验原密码、修改必验」（F4 修正，用户 2026-09-26 指令）由**服务端权威判定**，需要一次 `prisma migrate`——原批准的「零迁移」已作废（ADR-0009 决定 8 与 spec §10 已改）。**执行记录**：用户以 AskUserQuestion 选定「批准 A+B（推荐）」后执行——先 `--create-only` 核对，发现生成的 diff 会顺带重写历史手写迁移与 `schema.prisma` 的既有偏差（自定义 FK/索引名、`id` 列 DROP DEFAULT、`normalized_name SET NOT NULL` 等，与本次变更无关），故按授权所附的兜底改为**手写单行迁移** `20260926095348_add_password_set_by_user/migration.sql`（`ALTER TABLE "tenant_accounts" ADD COLUMN "password_set_by_user" BOOLEAN NOT NULL DEFAULT false;`，含注释说明为何不保留生成的 diff）；随后 deploy 到 `pw_saas` 与 `pw_saas_test`，退出码 0。**核对（2026-09-26 复验，只读）**：两库均 `44` 条已应用迁移、最新一条即 `20260926095348_add_password_set_by_user`；`information_schema` 读出 `public.tenant_accounts | password_set_by_user | boolean | nullable=NO | default=false`（两库一致）。`prisma generate` 已产出该字段；另按实施偏差 D4 执行了 `pnpm --filter @pw/database build`（`@pw/database` 的 `types` 指向 `dist/index.d.ts`，只跑 `generate` 会让消费方 `tsc` 读到过期 dist），退出码 0。**回滚**：`ALTER TABLE "tenant_accounts" DROP COLUMN "password_set_by_user";`（见 spec §10，两层回滚：代码回滚不需降级脚本）。

- （2026-09-26 更新）原「工作树未提交」一批中的商家端导航信息架构（7 业务域 / active-preview-planned 三态）、`modules.ts` 拆分为 `nav-registry` / `nav-domains` / `nav-access` / `nav-breadcrumb` / `console-path`，以及业务资金/对账/退款确认后端、契约、测试与支付台账 UI，已于 2026-09-26 分 8 笔提交入库（`007e190..3c73cd4`）；PR #3 入库的是 8 域版本。UI 打磨、E2E 更新、演示密码调整等是否仍有剩余，以 `git status --short` 实时结果为准。
- 服务目录新页 `CatalogModuleView` **只读**：区服（`GameRegion`）的写入仍只在旧页 `(tenant)/catalog/page.tsx`。契约上，新控制台的区服增删改未接通前，旧页与 `tenant-links.ts:30` 的入口都不能删。
- 游戏列表存在第三处 5 分钟缓存：`new-order-view.tsx`（key `["merchant","new-order","games"]`，经「智能助手 → 新建订单」可达）。服务目录页与新建模板对话框的 key 已互相标脏，这一处未接；其余 5 个读取方无 `staleTime`，会自愈。
- 折叠态域徽标只数「建设能力」（preview + planned），不区分可用性——裁撤「商品店铺」只是把这枚失真徽标移到「运营设置」（5 个真实项 + 11 个未来项），并未消除。
- 商家端 15 个 `preview` + 19 个 `planned` 模块仍未接业务接口（导航已登记，不允许伪造数据）。
- 门店收入账本未定义：经营工作台金额位的“经营入账（应收/实收/毛利）”保持“待开通”占位。
- 平台端：开店草稿未设计；平台总览的存储用量等无数据字段返回 `unavailable`。
- admin 旧页面与 `merchant-console` 新控制台并行，G4 渐进迁移继续“改到即迁”。
- Playwright E2E 已入库（根脚本 `test:e2e` = `playwright test`，2026-09-10 最近一次 `passed`），但尚未接入 CI（CI 无浏览器/服务启动步骤）。
- 容量基线（100 租户 / 100 万订单，只读 100 RPS、写 50 RPS、P95 达标记录）未做。
- 覆盖率质量债：`test:coverage` 已合并单元+集成，branch 63.7%（目标 80%；critical-domain 已达 100/100/100/100），2026-09-08 决定延后。配置侧 `tests/vitest.coverage.config.ts` 的 branch 阈值目前是 60（与 80 目标不一致，直接提到 80 会让 CI 红），本轮未复跑覆盖率故不更新此处的百分比。
- 自动催缴：余额/可服务时长接近耗尽时通知老板续费。
- 可选：worker 崩溃注入测试与死信人工管理界面（outbox relay 已有租约回收/退避/死信/人工重放）。

## D. 当前环境限制（不是产品缺口）

- 2026-09-11 核对时本地 Docker 守护进程未运行：集成测试、E2E 与 seed 需要先启动 Docker Desktop（postgres 5433 / redis 6380 / minio）。
- 未启动数据库时，`apps/api/src/app.module.spec.ts` 的 `/health` 用例会因 `database=down` 断言失败，属环境依赖，不代表代码回归。

## E. 已完成并归档（摘要，不再展开）

- 2026-09-26：**Bug 批量修复轮（用户实测反馈 4 条；Bug 1 / Bug 3 / Bug 4 已修并验证，Bug 2 只出方案）**。改动停在本地工作树（分支 `feat/account-password-registration`，**未提交、未推送**）。
  - **Bug 1「老板端『我的』按钮不显示名称」**：根因是 Taro H5 下 `<Button disabled>` 的禁用样式盖掉文字；修复 = `apps/mobile/src/components/customer-ui/styles.css` 补 `[disabled]` 颜色规则（截图证据，用户已确认）。
  - **Bug 3「已批准陪玩无法登录陪玩端」**：根因**不是后台没同步**——后台已正确追加 `PLAYER` 角色并建档（实测 `role=CUSTOMER` + `roles=["CUSTOMER","PLAYER"]`，`/tenant/player/me` 在切上下文后 200），而是**移动端从未调用 `switch-context`**：端上下文判别是单值（ADR-0009 决定 7），多角色账号登录后落老板端，直连陪玩端接口恒 403「需要陪玩身份」。修复 = 新增 `identityAdapter.switchContext`（契约 + H5 实现 + weapp 显式未配置桩）与 `features/player-context/{enter.ts,actions.ts}`（403→「陪玩申请审核中」且**不清 token**；401→清 token 退回登录卡；其它错误原样透出），6 个陪玩端页面入口改为「先切上下文再加载」；切来的 token 不回写 session。**同轮发现并修掉 API 侧缺陷**（用户单独授权越界）：`switch-context` 对「账号不持有目标端角色」抛 `InvalidCredentialsError` 而控制器未映射 → 全局过滤器转 **500 Internal server error**；新增 `ContextRoleMissingError` → 403，账号禁用/门店停用/账号不存在 → 401（消息不透出域错误原文）。**运行时证据（headless Edge + CDP；H5 3101 同源反代 → API 3300）**：①带老板端 token 直开陪玩端「我的」→ `switch-context` 1 次 → `/tenant/player/me` 200（修复前 403）→ 渲染「我的资料 / 接单时间 / 收入详情」，且 localStorage 里仍是老板端 token（未回写）；②在页面填表点「账号密码登录」→ 同样渲染成功；③未批准账号（`owner`）→ 403 → 页面显示「陪玩申请审核中或尚未通过；门店批准后重新进入本页即可。」且会话保留。**自动化**：`tests/integration/player-application.spec.ts` 新增 3 用例（未持有角色 403 / 非法 context 400 / 账号禁用 401），红→绿（修复前两条实收 500）；相邻 5 个套件 33 用例全绿；`apps/api` typecheck exit 0；`openapi:generate` 幂等（生成物零 diff）。移动端 typecheck / vitest（11 文件 52 用例）/ `build:h5` 全绿。
  - **Bug 4「客户档案与陪玩档案没有同步记录」**：修复 = 列表查询对解密失败的手机号降级（`tryDecryptPhone` 容错 + 告警日志），单行密文问题不再影响整个列表。只读核对：`GET /tenant/customers` 200（12 条，1 条有手机号 / 11 条「未绑定」）、`GET /tenant/players` 200（4 条，1/3）；API 日志 6 条降级告警（失败可见、非静默）。数据侧按用户决定**保留密文**（见 §C「PII 密钥漂移」）。
  - **Bug 2（大区 / 目标段位 / 模式联动与联想）本轮未实施**：按用户「先出方案」的授权只做设计，待批准后实施。
- 2026-09-26：**CI 门禁既有红修复 → 全流程门禁首次全绿**。根因链（有据）：①`22a2c0f`（2026-09-23）master 的 `ci` run `35865974518` **24 步全部 success**；②其后 9 笔入库（`007e190..9a742d0`，业务资金线 + 状态文档），其中 `ba2d12e` 新增 `apps/api/src/common/money.ts` 的 `fenToYuanText`，而关键域用例 `tests/integration/money-state-critical.spec.ts` 只为 `parseFenString` 写了断言 ⇒ 关键域覆盖率跌破 100% 阈值（lines 92.18% / functions 80%）；③master `9a742d0` 的 `ci` run `36200972243`（UTC 2026-09-25T23:25:40Z ≈ +0800 2026-09-26 07:25）红在 `pnpm test:coverage:critical`，**其后 7 步（迁移状态检查 / `format:check` / E2E `--list` / `openapi:check` / `build` / `build:h5` / `build:weapp`）全部 skipped**（Actions 首个失败步即止）；本分支 `3fb5a5a` 两次 run（UTC 10:58 / 10:59）继承同一既有红。修复：`5f33b19` 补 `fenToYuanText` 用例（合法换算 + 全部非法兜底 + 超 `Number.MAX_SAFE_INTEGER` 精度探针，断言 BigInt 结果；本机 statements/branches/functions/lines 均 100%，functions 5/5、branches 25/25），`30acbb4` 补齐 prettier 基线（本 slice 5 文件 + 业务资金线 12 文件，逐文件以 `git show HEAD:<f> | prettier --stdin-filepath <f>` 对比确认为纯格式化）。**结果**：`30acbb4` 两个 run（`36238861315` / `36238859906`，UTC 2026-09-26T11:27:10Z / 11:27:11Z）`ci` 均 `success` 且无 failed step，**24 步全部实际执行**；本机以 `git archive` 导出 HEAD 后跑真实 `prettier --check .` → 994 个文件匹配通过、退出码 0。**更正**：曾误记为「`format:check` 及其后门禁自 2026-09-23 起从未在 CI 执行」，经 09-23 那次 24 步全 success 的 run 核对**不成立**，实际是自 09-25 那次红起被 skip。**未含**：master 至今（`9a742d0`）仍红——修复只存在于本分支，合并 PR #4 才能修掉 master。
- 2026-09-26：**账号密码自助注册（SP2）交付**（`pushed`，分支 `feat/account-password-registration`，PR #4，**8 笔提交 `9e0bbe4..30acbb4`**，**已推送**；末 2 笔为门禁修复 `5f33b19` 关键域覆盖率既有红、`30acbb4` prettier 基线补齐）——新增 `POST /api/v1/auth/register`（单事务建 `tenant_accounts` + `CUSTOMER` 角色行 + `customer_profiles`；手机号可选绑定，冲突 409；门店停用 403（B1 补充）；限流按**尝试次数**计数，键 `{ip}:register:{tenantCode}`，5 次/15 分钟；成功写审计 `auth.register`（A1 补充））与 `POST /api/v1/auth/password`（分支由 `password_set_by_user` 判定：`false` 初次设置免验原密码、`true` 修改必验，不匹配/缺失 400 且一行不写；`platform` scope 一律按修改处理且**不写审计**（偏差 C1，受 `audit_logs.tenant_id NOT NULL` 约束））；契约再生成 2 个 operation 且幂等；mobile 新增注册页与设置密码页（H5 + weapp 双端可构建）、首页「注册新账号」入口、两个 profile 页的「设置密码」入口与老板端的「申请成为陪玩」入口；schema 变更 1 处（见 §C）。**门禁（2026-09-26）**：`pnpm test`（102 通过 / 1 跳过文件）、`pnpm test:integration`（61 文件 / 310 用例，含新增 13 条）、`pnpm test:tenant-isolation`（12 文件 / 44 用例）、`pnpm typecheck`（10 个 turbo 任务 + `typecheck:tests`）、`pnpm openapi:generate`（幂等）均退出码 0。**证据缺口（如实登记）**：Task 1/2 的单元层有完整红→绿，**集成层只有绿灯**（实现先于集成用例落地），红灯未取到——见实施计划偏差 D5 与计划内 Task 4 报告。设计依据 spec 与 ADR-0009；实施计划见 `docs/superpowers/plans/2026-09-26-account-password-registration-sp2.md`（偏差 D2–D11）。
- 2026-09-26：**多角色授权解析修复（SP1）交付**（`pushed`，同一分支（PR #4），**已推送**）——新增 `ROLE_PRIORITY` / `sortRolesByPriority` / `permissionsForAny`（`domain/roles.ts`）、`AccessPrincipal.roles`（`domain/principal.ts`）、JWT `roles` claim 签发与校验（`infrastructure/tokens.ts`）、守卫按角色集求并集并对旧 token 回退 `[role]`（`common/auth/permissions.guard.ts`）、`AuthService` 按优先级取主角色并签发全部角色（`application/auth.service.ts`）。运行时证据：修复前 `expected 200 "OK", got 403 "Forbidden"`（`tests/integration/player-application.spec.ts:182`），修复后同一请求 200。零迁移。设计依据 ADR-0009 决定 7 与 spec §4 SP1。
- 2026-09-11 校对：T1 平台开店闭环（含一键开店自动创建店主账号与 H5 交付）、平台端账号管理/临时跨租户授权/汇总审计/费率调整/订阅续费、经营工作台 v1（后端 `reporting` + 前端 WorkPage）、商家端控制台 P0–P4（场次与证据、结算批次明细、争议详情、审计、通知、客户与陪玩详情）、手机号验证码注册登录 P1、陪玩入驻申请、四端 UI 模板库、生产打包起步（Dockerfile api/admin/h5 + `docker-compose.prod.yml` + 部署 runbook）均已完成并入库。
- 2026-09-07 校对：Slice 0–11、R1–R5、Block1（通用订单+派单+选人）、Block2 P1–P5（老板钱包/场次结算）及本地联调修复 T2 均已结项；A1–A5、B1–B5、C1–C5、D1–D3、E1–E5 达标项、F1/F5、G1/G2 主链路、G3 已完成。
- 原“多实例登录限流 / CSRF / CI integration / 平台独立凭据与审计”等旧挂账项已在 2026-09-07 前结清，不再列出。
