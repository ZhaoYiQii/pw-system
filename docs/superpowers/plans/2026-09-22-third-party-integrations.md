# 第三方接入 Implementation Plan

Goal: 让系统具备**真实营业**所需的外部能力——手机号登录（真实短信）、微信登录（公众号网页授权）、微信支付（JSAPI）、对象存储（证据文件）、对外通知渠道——并把这些能力装到统一的 provider 装配层上，使其在缺凭证时**启动即失败而不是静默降级**。

Architecture: 所有外部能力沿用仓库既有的「接口 + DI token + 环境变量选择 + 生产硬失败」模式（短信模块已是范例）。**不引入第三方 SDK**：微信支付 APIv3 与短信服务商均为 REST + 签名，用 `node:crypto` 与内置 `fetch` 实现，规避依赖安装与供应链风险。支付回调走独立控制器，复用既有 `idempotency_records` 与 `payment_orders(provider, provider_ref)` 结构。

Tech stack: NestJS + Prisma 7 + PostgreSQL 18 + Node 24；admin-web（Next 16）与 mobile（Taro 4 / H5）不新增依赖。

Spec: 本文件（用户 2026-09-22 口径：线上支付、客户走 H5、暂不做小程序、先一家门店试运营、微信登录与手机号登录都要）。

Scope and non-goals:

- **做**：provider 装配层、真实短信、公众号网页授权 + 微信登录、微信支付 JSAPI（下单/回调/验签/幂等/关单）、对象存储 adapter、对外通知渠道、Linux 实机部署。
- **不做（明确后置）**：微信小程序（weapp）、聚合支付/支付宝、API 退款自动化（首版只做「未支付超时关单」+ 人工退款登记）、多时区、收入账本（试运营后再立项）、模块级自定义授权（已另有 ADR）。

## 已定口径（不再讨论）

1. 收款方式：**线上支付**（微信支付）。
2. 客户入口：**微信内打开 H5**；小程序不做。
3. 规模：**先一家门店试运营**（不做多门店运营/多时区）。
4. 登录方式：**手机号验证码登录 + 微信网页授权登录，两种都要**。手机号登录已实现（P1），只缺真实短信通道。
5. H5 内支付 ⇒ 采用 **JSAPI 支付**（需要 `openid`，因此 S3 网页授权是 S4 支付的前置）。

## 必须先确认的资质（决定 S2–S4 能否开工）

| #   | 项                                                                     | 用途                          | 现状                                                |
| --- | ---------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------- |
| 1   | **公众号（服务号）AppID / AppSecret**                                  | 网页授权拿 `openid`、微信登录 | 待确认（用户已给「有备案域名+商户号」，未提公众号） |
| 2   | 公众号「网页授权域名」是否已配置为该备案域名                           | 授权回跳                      | 待确认                                              |
| 3   | **商户号 + APIv3 密钥 + 商户私钥证书**（apiclient_key.pem / 平台证书） | JSAPI 下单、回调验签/解密     | 待确认具体形态                                      |
| 4   | 商户号与公众号是否**同一主体/已关联**                                  | 用 openid 调 JSAPI 支付的前提 | 待确认                                              |
| 5   | 短信服务商与密钥（**已选腾讯云**）                                     | 验证码                        | 已选定；资质/签名/模板过审中（S2 本体已完工）       |
| 6   | 对象存储服务商与密钥（阿里 OSS / 腾讯 COS…）                           | 证据文件                      | 待选定                                              |

> 注：**没有 1–4 就无法落地微信支付**。若公众号还没有，S3/S4 只能先做代码与本地 harness，联调要等资质。

## 环境限制（影响验收方式）

- 本机沙箱**网络受限**，无法直连微信/短信/OSS 做真实联调；因此每片的验收拆成两段：
  - **本机可得**：类型检查、单测（签名/验签/状态机用固定向量）、启动期硬失败实测、回调端点用构造报文实测；
  - **需你或服务器执行**：真实下单、真实短信送达、真实回调（我会给出可照抄的 curl/脚本与预期）。

## Slices

### S1 provider 装配层（不依赖任何凭证，可立即开工）

**S1a（已完成）**：支付的 DI token 从具体类 `MockPaymentProvider` 改为字符串 token `PAYMENT_PROVIDER` + 工厂返回接口 `PaymentProvider`，与短信模块同构，并导出 `resolvePaymentProvider` 以便测试。
验收证据：`wallet.module.spec.ts` 5 条（未配置→点名 `PAYMENT_PROVIDER`；未知通道→不退回 mock；生产+mock 未放行→点名 `ALLOW_MOCK_PAYMENT`；生产显式放行→可用；非生产→默认 mock）；`tsc -p apps/api` 0；全量单测 56 files / 379 passed；**启动期实测**：`NODE_ENV=production` + `PAYMENT_PROVIDER=mock` 且未设 `ALLOW_MOCK_PAYMENT` → 退出码 1、错误行含 `ALLOW_MOCK_PAYMENT`、端口从未监听。

**S1b（对象存储抽象，待实施）**——拆两片，避免一次改动过大：

- **S1b-1**：新增 `StorageProvider` 接口（`kind` / `put(key, bytes, {mimeType})` / `read(key)` / `remove(key)`）+ 本地实现 + 共享 `StorageModule`（导出 token 供两个 feature module 复用）；把 `slot-session.controller.ts` 的写入与失败清理改走 provider。
  现状足迹：`slot-session.controller.ts:62-66` 自有 `rootDir()`；`:229-233` `mkdir` + `writeFile({flag:"wx"})` + 失败 `unlink`；`:260` 失败 `unlink`。
  验收：单测（put/read/remove 往返、未知 provider 启动报错、生产 local 告警）+ `tsc` + 起服务上传证据仍 201。
- **S1b-2**：`evidence.controller.ts` 的写入与**两个下载端点**改走 provider（现状：`:85-89` 自有 `rootDir()`；`:210-214` / `:246` 写入与清理；`:276-285`、`:310-313` 两处 `readFile` + 手写 header）。
  验收：单测 + 起服务下载同一份证据仍 200 且字节一致。

**关键设计约束（已定）**：`STORAGE_PROVIDER` 采用「未知值 → 启动报错」，但**不得**在生产对 `local` 硬失败——现有 `container-smoke` 与生产 compose 正使用本地存储（`EVIDENCE_ROOT=/app/data/evidence`），硬失败会打红 CI 与部署；因此生产选 `local` 时只 **warn**（提示多实例或容器重启会丢文件）。
**不在本片加 `signedUrl()`**：本地实现给不出签名 URL、对象存储尚未接入，加了就是没有消费者的空接口；S5 需要时再按 ADR 扩展。

### S2 真实短信（腾讯云）—— 本体已完成；真实送达待凭证

**S2-0（已完成）**：`SendSmsCodeInput` 补 `mobile`（真实通道必须拿到号码才能投递，原来只有 `phoneTail`）；`SmsProviderKind` 加 `tencent`。

**S2-本体（已完成）**：`apps/api/src/modules/identity-access/infrastructure/tencent-sms.provider.ts`——TC3-HMAC-SHA256 签名用 `node:crypto` 手写、HTTP 用内置 `fetch`（**不引入腾讯云 SDK**，不扩大供应链面）；装配进 `identity-access.module.ts` 的 `resolveSmsProvider()`（`mock | tencent`，未知值抛错且**不退回 mock**，`tencent` 缺凭证**启动即失败并点名变量**）。

设计决定两条（写在这里以免下次重复讨论）：

1. **不要「模板参数名」**：腾讯云 `TemplateParamSet` 是字符串数组、按位置取值，请求里没有参数名字段。本 adapter 只支持**单变量验证码模板**，固定传 `[code]`。若过审模板含多个变量，第一次真实调用会报 `FailedOperation.TemplateParamSetNotMatchTemplate` 一类错误——那种情况下再按模板实际变量数扩展。
2. **同步调用带 5s 超时**：验证码在登录链路上，卡住会一直占着用户请求。超时/网络失败/返回体非 JSON 都归一成 `TencentSmsError`（`kind=retryable`），原始原因进 message，不留「堆栈看不懂的 500」。

验收证据（本机可复跑）：

- `apps/api/src/modules/identity-access/infrastructure/tencent-sms.provider.spec.ts`：**13 passed**——缺变量点名、默认值、E.164 转换、错误分类、请求拼装、签名对同输入稳定（换密钥/换时间必变）、成功路径、API 级错误、单号失败、网络失败、超时、非 JSON 响应。
  **红先绿证据**：初版 spec 把注入的时钟写成数字而非函数 → `Test Files 1 failed / Tests 3 failed | 6 passed`，报 `TypeError: this.now is not a function`；修正注入后 13 passed。
- `apps/api/src/modules/identity-access/identity-access.module.spec.ts`：**6 passed**——默认 mock、tencent 齐全、缺凭证点名、未知值不退回 mock、生产+mock 未放行、生产+tencent 放行。
  注：这 6 条是**改动后补的回归锚点**，不是红先绿；改动前该分支直接抛 `SMS_PROVIDER only supports mock until real provider is implemented (P-5)`（可 `git show 16a1599:apps/api/src/modules/identity-access/identity-access.module.ts` 复核），故这些用例在改动前必然红。
- **启动期实测（跑真实 `dist`，不是单测）**：`audit/s2-startup-guard.mjs`
  - 负向：`NODE_ENV=production` + `SMS_PROVIDER=tencent` + 清空 5 个 `TENCENT_SMS_*` → 退出码 **1**、错误行点名**全部 5 个**变量、3399 端口**从未监听**；
  - 正向对照（同环境、变量填假值）→ `/health` **200**。这一条是必须的：否则「进程挂了」可能是别的原因（本仓库踩过「启动慢 vs 产物缺失」的假结论）。
- `typecheck`（api）与 `typecheck:tests` 退出码 0；全量单测 **402 passed / 1 skipped**；`lint` 0；`format:check` 0。
- 配置面同步：`docker-compose.prod.yml` 的 `api` 与 `pw-init` 都传入 6 个腾讯云变量（`pw-init` 会走身份模块；`worker` 不装配短信通道，保持不传）；`infra/docker/env.prod.example`、`.env.example`、`docs/runbooks/env-inventory.md` 同步。

**未验证（不得当成已通过）**：TC3 签名的正确性、真实送达、模板变量个数是否匹配。
判据：签名错 → `AuthFailure.SignatureFailure`；模板变量数不匹配 → `FailedOperation.TemplateParamSetNotMatchTemplate` 一类；频控/额度 → `LimitExceeded.*`。
**第一次真实调用之前，签名只能算「按文档实现」。**

真实送达步骤（过审后由你或服务器执行）：

1. 写 `D:\pw system\.env.sms.local`（实测 `git check-ignore -v .env.sms.local` → `.gitignore:17:.env.*`，不会入库）：
   `SMS_PROVIDER=tencent` / `TENCENT_SMS_SECRET_ID` / `TENCENT_SMS_SECRET_KEY` / `TENCENT_SMS_SDK_APP_ID` / `TENCENT_SMS_SIGN_NAME` / `TENCENT_SMS_TEMPLATE_ID` / `TENCENT_SMS_REGION=ap-guangzhou`。
2. `corepack pnpm --filter @pw/api build`，然后用 `restart-3300-sms.ps1`（读 `.env.sms.local` 覆盖这 6 个变量后起 3300）。
   本片用到的本地脚本都在 `C:\Users\Listener\.codex\visualizations\2026\09\21\01a0c64c-b07c-75a0-86de-4021dbd26c26\audit\`
   （沙箱可写区，不进仓库）：`restart-3300-sms.ps1`、`probe-send-code.mjs`、`probe-login.mjs`、`s2-startup-guard.mjs`。
3. 发一发：`node <audit>\probe-send-code.mjs s5cwalk 1xxxxxxxxxx`（**不要用 PowerShell 里的
   `curl.exe -d "{...}"`**：PS 5.1 会吃掉内层双引号，请求体变成非法 JSON，端点回 400「tenantCode/phone 必填」，
   看起来像后端坏了——2026-09-22 实测踩到，故改用 node fetch 探针）。
   预期：HTTP 200 且响应体**没有 `debugCode`**（带 `debugCode` = 还在走 mock），手机收到短信。

### S3 公众号网页授权 + 微信登录（S4 前置）—— 设计已定，待资质确认后开工

事实基础（已核，2026-09-22）：

- 现有客户登录是「短信码 → 按 `phone_hash` 找/建 `TenantAccount` → 发 `CUSTOMER` 会话」（`auth.service.ts:130` `phoneCustomerLogin`）；账号身份键是 `(tenantId, username)` 与 `(tenantId, phoneHash)`（`schema.prisma:150`）。
- 全仓**没有** openid/unionid/授权代码；`.env.example` 里的 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 目前没有任何消费者。
- H5 侧：`apiAdapter` 带 `credentials: "include"` + Bearer；`phoneLogin()` 把 `accessToken` 写 localStorage、`csrfToken` 另存（`features/customer-ui/session.ts:25`）；客户登录 UI 在 `pages/customer/home/index.tsx`。

**两个必然的落库变更**

1. `TenantAccount.wechat_openid String?` + `@@unique([tenantId, wechatOpenid])`：公众号身份键。openid 是 app 级唯一，单公众号足够；将来做小程序/多公众号需要 unionid 时再升级成独立 `wechat_identities` 表（迁移是机械的）。
2. 新表 `wechat_login_requests`（租户级 RLS）：`id / tenantId / openid / ticketHash(unique) / returnTo / status(PENDING_PHONE|CONSUMED) / expiresAt / consumedAt / createdAt`。
   **为什么必须有**：首次登录是「已授权（拿到 openid）但还不算账号」的中间态，必须在服务端短期保存；用一次性票据把它交给 H5，**不能把 openid 或 token 放进 URL**。用 DB 行而不是「带回浏览器的签名 bindToken」：票据单次消费 + 服务端可作废，绑定这种会改变账号归属的操作值得更硬的保证。

**推荐流程（B 口径：首次绑手机号）**

```
H5 点「微信登录」
 → GET /api/v1/auth/wechat/authorize?tenantCode=..&returnTo=..   (302 到微信)
     redirect_uri = WECHAT_OAUTH_REDIRECT_URI（**H5 域名的入口页**，见下方口径）
     state = 签名短期 JWT {tenantCode, returnTo}，10 分钟过期
 → 微信授权页 → 微信 302 回 H5：GET https://<h5>/?wechat_login=1&code=..&state=..
 → H5 入口页发现 code+state：POST /api/v1/auth/wechat/login { code, state }
     服务端：验 state → 用 AppSecret 把 code 换 openid
     ├ openid 已绑定账号 → 直接签发与手机号登录**同构**的会话（refresh cookie + access token + csrf）
     └ 未绑定          → 返回 { needPhone: true, bindTicket }（票据行 PENDING_PHONE，60 秒）
        → H5 走已有短信码流程：POST /api/v1/auth/wechat/bind-phone { bindTicket, phone, code }
           consumeCode（复用 phone-verification）→ 按 phone_hash 找/建账号 → 绑 openid → 发会话
```

**为什么不在 API 侧做回调（2026-09-22 修订）**：原设计是 `redirect_uri` 指到 API 的 `/wechat/callback` 再 302 回 H5 带票据。改成 H5 入口页收 code 后，**只需要在公众号后台配 H5 一个网页授权域名**（API 域名不必也在白名单里），少一个端点、少一次跳转；而且 Taro H5 是 hash 路由，把 code 交给 API 的回调再拼 fragment 容易踩「code 落在 # 之后」的坑。代价是 `code` 会经过浏览器地址栏——这是 OAuth 的常态，且 code 单次消费、5 分钟失效。

**为什么首次要绑手机号（要你确认的一点）**：一台门店只能有一条「人」的记录。先微信后手机号、先手机号后微信，都必须落到同一个账号；只认 openid 不绑手机，同一个人会得到两个账号（phoneHash 一个、openid 一个），订单与钱包会分裂——这是数据一致性风险，不是 UI 取舍。代价是首次多一步（一条短信），并且我们的手机号通道已经就位（S2）。

若选 A（openid 即账号、不绑手机）：实现更少，但要接受上面的分裂风险，且手机号登录时必须做账号合并，总工作量反而比 B 大。

**安全口径**

- `state`：jose 签名 JWT（已是依赖），10 分钟过期，绑定 `tenantCode + returnTo + nonce`；`returnTo` 只接受**站内相对路径**（`//evil.com`、`https://…`、含反斜杠与控制字符的一律回退 `/`），杜绝开放重定向。
- 授权 scope 默认用 `snsapi_base`（静默拿 openid，用户无感，进 H5 即可自动登录）；将来若要显示昵称头像再上 `snsapi_userinfo`（会多一次用户确认）。这条我没在本机验证过，第一次真实调用时确认。
- 微信 `code` 只能用一次（微信侧保证，5 分钟）；我们换到 openid 后立刻落 PENDING_PHONE 票据行，消费一次即作废。
- `bindTicket`：32 字节随机、只存 hash、单次消费、60 秒过期。
- AppSecret 只在服务端，且**任何错误信息与日志都不带请求 URL**（微信要求把 appsecret 放在查询串，URL 一旦进日志就是密钥泄漏）；传输层错误原文进错误信息前会把 appsecret 替换成 `***`；日志对 openid 只留首尾各 4 位。

**本机可验证 vs 需资质**

- 可验证（本机）：authorize 的 302 与 state 结构；state 伪造/过期/跨 audience 混用；脏 `returnTo` 回退；code→openid 交换与全部错误码分类（stub 客户端）；密钥不出现在错误信息里；票据单次消费与过期；绑定冲突（openid 已绑 A 却要绑 B）；重复绑定幂等。
- 需资质：真实授权页、真实 code 交换、网页授权域名校验。判据：回调能拿到 openid 并签发会话；失败时微信返回 `40029 invalid code` / `redirect_uri 域名与后台配置不一致`。

**切片**

- **S3a-1（已完成，无 DB 依赖）**：`infrastructure/wechat-oauth.client.ts`（配置门禁 / authorize URL / code→openid / errcode 分类 / 密钥脱敏 / openid 掩码）+ `infrastructure/wechat-state.ts`（state 签名校验 + `returnTo` 白名单）。
  验收：`wechat-oauth.client.spec.ts` 12 passed、`wechat-state.spec.ts` 8 passed；`typecheck`（api）0；全量单测 422 passed / 1 skipped。
  两处真实红→绿：① 我最初的断言是「错误信息不含主机名」（过严，主机名不是秘密），红 → 改成钉「密钥不出现在错误信息里」并给实现加脱敏，绿；② tsc 抓到我在 spec 里用 `.catch(e => e as Error)` 导致联合类型，红 → 改成 try/catch 收敛，绿。
- **S3a-2**：迁移（openid 列 + `wechat_login_requests` 表 + RLS 策略）+ 把 client/state 注册进模块（工厂 + 缺凭证启动即失败的本机实测）。
- **S3b**：端点（authorize 302 / login / bind-phone）+ 票据生命周期 + 单测与 stub 端到端。
- **S3c**：首绑手机号规则（复用 `consumeCode`）+ 冲突与幂等（openid 已绑 A 要绑 B、手机号已有账号要绑 openid）。
- **S3d**：H5 接入（`pages/customer/home` 加「微信登录」+ 入口页识别 code/state + 首绑页 + 文案），含 H5 单测与走查。

**开工前要你确认 4 件事**：① 公众号是否**已认证、且是服务号**——网页授权本身认证号即可，但 **S4 微信支付 JSAPI 只支持服务号/小程序**，所以服务号是硬要求（服务号/订阅号的具体权限差异我按官方文档执行，不在本机臆断）；② 「网页授权域名」是否已配置为 H5 的备案域名；③ 商户号与公众号是否同一主体/已关联（S4 前置）；④ 首次微信登录是否要求绑手机号（推荐要求）。

### S4 微信支付 JSAPI

- 下单：金额整数分 → 调 JSAPI 下单 → 返回 `prepay_id` 与前端支付参数（含 RSA 签名）。
- 回调：验签（平台证书）+ AES-256-GCM 解密 → 幂等（复用 `idempotency_records` + `payment_orders.provider_ref`）→ 驱动钱包/订单状态机。
- 关单：未支付超时自动关闭（复用既有 outbox/定时任务）。
- 验收：单测（签名/验签/解密固定向量、重复回调幂等、金额不符拒绝）+ 本地构造回调实测；真实支付需商户号与证书。

### S5 对象存储 adapter

- 上传/下载改走 provider（本地 FS 保留为 dev 实现）；访问改为**签名 URL**。
- 验收：单测 + 本机起服务实测上传/下载；真实 OSS 需密钥。

### S6 对外通知渠道

- 新建 sender 抽象（微信模板消息/短信），复用现有 outbox 重试与死信。
- 依赖 S2（短信）与 S3（微信）。

### S7 Linux 实机部署（与代码并行可做）

- 域名 + HTTPS + H5 同源反代；`docker-compose.prod.yml` 实机跑通；备份/恢复演练与 runbook。
- 这是 AGENTS.md 的部署门禁项（「未完成 Linux 容器验证不得声称可部署到 Linux」）。

## 每片的完成证据要求（沿用仓库规则）

- 先红后绿的失败证据与实际输出、退出码；
- `lint` / `typecheck` / `format:check` / `openapi:check`（涉及契约时）的退出码；
- 涉及凭证的片：明确列出「本机已验证」与「需真实凭证才能验证」两部分，后者不得写成已通过；
- 提交与推送分别授权。

## 顺带发现（S3 侦察时撞见，本轮未修，等你决定要不要单独切片）

**租户表 RLS 覆盖不完整**（2026-09-22，只在一次性测试库 `pw_saas_s2_task2_20260916` 上核过）。

证据 1（目录层）：带 `tenant_id` 但缺 `tenant_isolation_runtime` 策略的表有 4 张，其中 4 张连 RLS 都没开
（复跑：`$env:PLATFORM_DATABASE_URL=...; node audit/q.mjs audit/rls-audit.sql`）：

| 表                         | rls_enabled | rls_forced | policy_count |
| -------------------------- | ----------- | ---------- | ------------ |
| `phone_verification_codes` | false       | false      | 0            |
| `player_applications`      | false       | false      | 0            |
| `refresh_sessions`         | false       | false      | 0            |
| `platform_access_grants`   | false       | false      | 0            |

- `refresh_sessions` / `platform_access_grants` 属**设计如此**：`schema.prisma:227` 注释写明「非租户业务表…不启用 RLS；运行时角色可读写（登录/刷新流程）」——登录/刷新本来就发生在租户上下文之前。
- `phone_verification_codes`（`schema.prisma:171` 注释写的是「租户级资源，**启用 RLS**」）与 `player_applications` 则是**注释与实现不一致**：`20260910040000_phone_verification_p1/migration.sql` 只建表建索引，没有 `ENABLE ROW LEVEL SECURITY`，也没有策略；全仓也没有「按 tenant_id 列自动补策略」的兜底循环（`rg "information_schema|FOR .* IN|EXECUTE format"` 在 migrations 下 0 命中）。

证据 2（运行时角色行为）：用 `pw_runtime` 在不设 `app.tenant_id` 的情况下数行数
（`node audit/q.mjs audit/rls-runtime-check.sql`，对照 owner 侧行数 `audit/rls-rowcounts.sql`）：

- `tenant_accounts`：owner 50 行 → 运行时可见 **0**（策略生效，对照组，说明这套探测方法有效）
- `refresh_sessions`：owner 4509 行 → 运行时可见 **4509**（与「设计如此」一致）
- `phone_verification_codes` / `player_applications`：owner 侧各 **0 行** → **这两个表的跨租户可读性未被证实**，缺策略这条目前只有目录层证据（`pg_class` / `pg_policy`）支撑。

影响与定级：属**纵深防御缺口**，不是已证实的数据泄漏（应用侧目前都带 `tenantId` 过滤，如 `phone-verification.service.ts` 的 `withTenantContext`）。但 `player_applications` 同时被 `game-dispatch.service.ts` 引用，要定级必须先做代码审计（确认没有跨租户查询路径），再补 `ENABLE + FORCE RLS + 两条策略`，并在**有数据**的库上验证「无租户上下文 → 0 行」。**本轮的结论仅到「策略缺失属实 + 影响未定」这一层。**

另外核过、**不成立**的一条：`refresh_sessions` 4509 行并非「过期行堆积」——`expires_at` 全部在未来（最早 2026-09-29，`audit/refresh-sessions-retention.sql`），是这轮反复登录测试留下的正常会话。
