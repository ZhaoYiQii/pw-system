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

### S3 公众号网页授权 + 微信登录（S4 前置）

- 新增授权入口与回调：`/api/v1/auth/wechat/authorize` → 微信授权页 → 回调换 `openid` → 绑定/创建账号 → 签发与手机号登录**同构**的会话。
- 落库：账号需记录 `openid`（含唯一约束与租户隔离）。
- 验收：单测（state 防重放、绑定冲突、已绑定直接登录）+ 本地 harness 模拟微信返回；真实授权需资质。

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
