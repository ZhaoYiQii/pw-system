# 交接：S4-5c 后台「支付设置」最小页（一次做完）

日期：2026-09-23 ｜ 状态：待执行（用户要求"规划好后一次完成"）

## 目标（范围已被用户砍到最小）

后台只做一张**最小页**，对应平台真正必需的三件事，**不做进件表单/材料上传界面**（方案 A，见设计文档第 13 节）：

1. **状态卡**：现在能不能收款 + 下一步谁做什么；
2. **子商户号绑定**：门店在服务商后台开好户后，把子商户号填进来；
3. **刷新状态**：查微信把状态刷成「已可收款」。

## 已确认的仓库约定（照抄，不要再重新摸）

- 页面新栈：`"use client"` + TanStack Query（`QueryClient/QueryClientProvider/useQuery/useMutation/useQueryClient`）+ `@/components/ui/*`（已确认在用：`badge`、`button`、`card`、`table`）。
- 数据层：`apps/admin-web/app/_lib/api.ts` → `apiFetch<T>(path, { method, body })`、`ApiError`；token 由 `getAccessToken/setAccessToken` 管理。
- 页面壳：`apps/admin-web/app/_lib/tenant-shell.tsx` → `TenantShell({ children })`（只接 children）。
- 相对路径：从 `app/(tenant)/<a>/<b>/page.tsx` 到 `app/_lib/*` 是 `../../../_lib/*`。
- 金额格式化：`apps/admin-web/app/_lib/money.ts` 的 `formatFenYuan`（金额一律整数分、十进制字符串）。
- 页面文件：`apps/admin-web/app/(tenant)/payments/settings/page.tsx`。

## 后端接口（都已进 `openapi.yaml`，无需再动后端）

| 方法与路径                                     | 权限             | 说明                                                     |
| ---------------------------------------------- | ---------------- | -------------------------------------------------------- |
| `GET /api/v1/tenant/payments/account`          | `finance.manage` | 读状态（老板/财务可读）                                  |
| `POST /api/v1/tenant/payments/account/bind`    | `tenant.manage`  | 绑定子商户号（仅老板），body `{ subMchid }`，6-32 位数字 |
| `POST /api/v1/tenant/payments/account/refresh` | `tenant.manage`  | 刷新（仅老板），查微信申请单 + 开户意愿确认状态          |

返回体（`PaymentSetupView`，字段名以 OpenAPI 为准）：`configured`、`status`（APPLYING/PENDING_CONFIRM/ACTIVE/SUSPENDED）、`nextAction`、`nextActionText`、`guidance`、`canAcceptPayment`、`subMchid`、`subAppid`、`applyNo`、`businessCode`、`providerState`、`providerStateMsg`、`authorizeState`、`rejectDetail[]`、`signUrl`、`source`、`submittedAt`、`lastSyncedAt`。

错误语义：400 入参、409 状态不允许、**502** 微信侧失败（消息里带微信错误码）、**503** 支付未启用或缺微信支付公钥。

## 执行步骤（一口气做完，中途不要回问）

1. 写页面（三块：状态卡 / 绑定表单 / 刷新按钮；按钮在请求中要禁用，错误消息直接显示后端返回文案）。
2. 加入口：在商家端导航注册处加一项「支付设置」（注意既有的 navigation/modules 注册表，别硬编码散落）。
3. `corepack pnpm --filter @pw/admin-web typecheck` + `lint`。
4. 重建并重启商家端：`corepack pnpm --filter @pw/admin-web build` → `powershell -File <audit>\restart-3005.ps1`（既有脚本）。
5. Playwright 登录（`demo` 门店 owner，密码 `zcloud1024`）打开该页 → **截图**（三态之一 + 绑定表单 + 刷新按钮）→ 点「刷新」再截一张，证明状态文本会变。
6. 跑完整 7 道门禁（`audit\prepush-gates.ps1`）。
7. **自主提交 + 推送**（用户已授权），推完立刻 `gh run list` 看结果；红了先修再继续。

## 验收判据（缺一不可）

- 截图里能看到：状态卡（未配置 / 待扫码签约 / 已可收款三态之一）+ 子商户号输入 + 刷新按钮；
- 点刷新后页面状态文本有变化，且**错误原样透出**（不美化掩盖）；
- `@pw/admin-web` typecheck/lint 通过；7 道门禁全绿；CI 绿。

## 之后（等外部条件，不开发）

微信认证 / 服务商资质通过 + 拿到凭证后，按联调清单跑真实链路：1 分钱真实下单 → 真实回调 → 入账 → 拉账单对账 → 退款登记 → 门店绑定刷新。

需要用户提供：`sp_mchid`、APIv3 密钥、商户 API 私钥 + 证书序列号、`sp_appid` + AppSecret、微信支付公钥（ID + 文件）、回调域名 HTTPS 可达、服务商公众号「网页授权域名」配 `h5.17ai.club`、门店子商户号 + 老板扫码完成开户意愿确认。
