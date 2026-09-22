# 移动端真机走查清单（H5）

- 目的：把「只有真机能暴露的问题」（键盘遮挡、安全区、滚动、返回栈、弱网、字体缩放）在陪玩端/老板端 H5 上过一遍。
- 范围：Taro H5 产物（`apps/mobile/dist`）。**不含**微信小程序真机（weapp 目前只验证到构建通过）、不含商家端 Web（已有 Playwright 桌面覆盖）。
- 前置：本清单里的页面与文案以 `main` 当前代码为准（P3 收口后：报单审批有时长对照、商家端有违约台账、选人可填固定价）。

## 一、准备环境（本地测试库，已实测可用）

1. 生成夹具（一次性测试库 `pw_saas_s2_task2_20260916`）：

   ```powershell
   $env:DATABASE_URL='postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
   $env:API_BASE='http://127.0.0.1:3300'
   node work/s5c-walkthrough-seed.mjs scenario
   ```

2. 起「手机可访问」的 H5 + API（H5 静态服务需绑定 `0.0.0.0`，API 的 CORS 要带上局域网来源）：

   ```powershell
   # 终端 A：API（把 H5_ORIGIN 换成你的局域网地址）
   $env:DATABASE_URL='postgresql://pw_runtime:pw_runtime_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
   $env:PLATFORM_DATABASE_URL='postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
   $env:EVIDENCE_ROOT='D:\pw system\work\tmp-evidence'
   $env:SESSION_SECRET='walkthrough-secret-0123456789-0123456789-0123456789'
   $env:PAYMENT_PROVIDER='mock'; $env:ALLOW_MOCK_PAYMENT='true'
   $env:SMS_PROVIDER='mock'; $env:ALLOW_MOCK_SMS='true'
   $env:PII_MASTER_KEY='<32 字节 base64>'
   $env:H5_ORIGIN='http://192.168.21.4:3101'      # ← 你的局域网 IP
   $env:ADMIN_WEB_ORIGIN='http://127.0.0.1:3005'
   $env:PORT='3300'
   node apps/api/dist/main.js

   # 终端 B：H5（0.0.0.0:3101，/api 反代到 3300）
   node work/phone-h5-server.mjs
   ```

3. 手机与电脑连**同一 Wi-Fi**，浏览器打开 `http://192.168.21.4:3101`（换成你的 IP）。

   账号（夹具 `s5cwalk`，密码统一 `zcloud1024`）：老板 `owner`、陪玩 `player1` / `player2`。

常见坑：

- 手机打不开 → Windows 防火墙未放行 3101 入站；或手机开了代理/VPN（**关掉再试**）。
- 电脑端自测别开系统代理：`curl --noproxy '*' http://<IP>:3101/`（走代理会拿到 502，不是服务问题）。
- 局域网 IP 用「默认路由所在网卡」的那个（`Get-NetRoute -DestinationPrefix '0.0.0.0/0'`），别用 WSL/Hyper-V 的 `172.x` 虚拟网段。

## 一之二、本机自动化 H5 E2E（Playwright，跑在 3101）

真机走查之前先跑这一层：它覆盖「H5 能登录、能下单、商家端能看到该单」的链路，**改了 H5 代码后一定要跑**。2026-09-22 起 H5 与 weapp 分目录输出（H5=`apps/mobile/dist`、weapp=`apps/mobile/dist-weapp`），`build:weapp` 不再覆盖 H5 产物；但改完 H5 代码仍需重建 H5 才会反映到本层用例。

前置：`apps/mobile/dist` 必须是当前 H5 产物（`corepack pnpm build:h5`）。H5 产物按**同源** `/api` 调用后端，所以本地必须靠 `phone-h5-server.mjs` 反代，不能用 `file://` 或别的静态服务器。

1. 陪玩端 / 老板端两条用例（夹具门店 `c1` **只存在于 dev 库 `pw_saas`**，所以 3300 这个 API 必须连 `pw_saas`，H5 反代到它；若 3300 连的是一次性测试库，本组用例会在登录处红）：

   ```powershell
   $env:PHONE_H5_PORT='3101'; $env:PHONE_API_PORT='3300'
   node work/phone-h5-server.mjs        # 另开一个终端常驻
   node node_modules/@playwright/test/cli.js test --project=mobile-h5
   ```

   这两条用例用**可访问名称**定位输入框（陪玩端 label 生效、老板端 placeholder 生效，用 `or()` 同时兼容），不要改回写死 placeholder——那样会把另一个页面打红。

2. 跨入口用例（H5 下单 → 商家端可见，**必须**指向一次性测试库）：

   ```powershell
   # 先按本节「二、准备环境」造一次夹具（s5cwalk），并让 API 指向测试库
   $env:PHONE_H5_PORT='3101'; $env:PHONE_API_PORT='3100'
   node work/phone-h5-server.mjs        # 换成反代 3100
   $env:E2E_API_ORIGIN='http://localhost:3100'
   $env:H5_ORIGIN='http://localhost:3101'
   $env:ADMIN_ORIGIN='http://localhost:3006'   # 商家端也要指向 3100
   node node_modules/@playwright/test/cli.js test --project=cross-entry
   ```

   注意：H5 反代目标（`PHONE_API_PORT`）按用例切换，**同一个 3101 不能同时喂两个库**——跑之前先停掉旧进程再起新的。

3. 报单审批链路里的那条 H5 用例（`pricing-slot-report` project 的「陪玩端 H5」）：
   它同样要求 3101 在跑且反代到**它用的那个库**；否则 Playwright 会先把整组夹具判为缺失而跳过（不是失败但也没覆盖），看起来像「跑了但还是没用例」。

## 二、走查清单

### A. 陪玩端（player1）

| #   | 页面 / 路径  | 操作                                              | 期望结果                                                                    |
| --- | ------------ | ------------------------------------------------- | --------------------------------------------------------------------------- |
| A1  | 登录页       | 输入门店 code / 账号 / 密码                       | 进入「可接订单」；错误密码有明确提示且不白屏                                |
| A2  | 可接订单大厅 | 查看卡片                                          | 每张卡片显示**单价（¥xx.xx / 小时，不乘时长）**与「报名」按钮；下拉刷新可用 |
| A3  | 大厅 → 报名  | 点「报名」                                        | 提示成功；重复报名返回受控提示（不崩）                                      |
| A4  | 我的报名     | 查看列表                                          | 状态与单价正确；「取消报名」仅未选中时可用                                  |
| A5  | 服务场次     | 开始服务 → 上传开始证据 → 上传结束证据 → 结束服务 | 每步有反馈；结束前必须先有证据；结束时间不足会给出提示                      |
| A6  | 报单         | 填申报时长 + 上传「报单开始/结束截图」            | 时长 15–1440 分钟内可提交；越界有明确提示；提交后状态变「待审批」           |
| A7  | 报单后       | 查看场次详情                                      | 显示「待审批」；客服审批通过后显示金额（陪玩实收）                          |

### B. 老板端（owner）

| #   | 页面 / 路径 | 操作                     | 期望结果                                                       |
| --- | ----------- | ------------------------ | -------------------------------------------------------------- |
| B1  | 老板端下单  | 选择模板 → 填表单 → 提交 | 生成订单；表单字段渲染正确（含下拉/文本）                      |
| B2  | 选人页      | 查看候选人               | 每个候选人显示**同一口径的单价**（不乘时长）；选中前可自助取消 |
| B3  | 钱包        | 查看余额 / 充值          | 金额显示为分转元两位小数；充值金额校验有提示                   |
| B4  | 我的订单    | 查看订单状态文案         | 与后端状态一致（含「待确认结算」「已完成」「已取消」）         |

### C. 通用（每个页面都建议过一眼）

| #   | 检查项      | 期望                                               |
| --- | ----------- | -------------------------------------------------- |
| C1  | 键盘弹出    | 输入框不被遮挡，能正常提交（iOS/Android 各看一次） |
| C2  | 刘海/安全区 | 顶部标题与底部按钮不被遮挡（异形屏）               |
| C3  | 长列表滚动  | 滚动流畅、无白屏、无重复请求                       |
| C4  | 返回栈      | 系统返回键/手势能回到上一页，不退出到空白页        |
| C5  | 弱网        | 切 4G/限速后提交，失败有提示可重试；不出现无限转圈 |
| C6  | 字体放大    | 系统字体调大后不串行、不溢出                       |
| C7  | 微信内打开  | 微信内置浏览器（Android/iOS）能正常登录与操作      |

## 三、结果怎么回报

每条问题请给：**设备 + 系统 + 浏览器/微信版本**、**页面路径**、**订单号（如有）**、**期望 vs 实际**、**截图**（命名 `序号-页面-问题.png`，例：`A6-报单-提交按钮被键盘挡住.png`）。

可直接套用：

```
设备：iPhone 14 / iOS 18.2 / 微信 8.0.5x
页面：陪玩端 → 报单
订单：GDMxxxx / 档位 id
期望：填 95 分钟后能提交
实际：点提交后按钮无反应，截图见 A6-报单-提交无响应.png
复现步骤：1) 结束服务 2) 打开报单页 3) 填 95 4) 点提交
```

## 四、本轮明确不在范围（避免误报）

- **微信小程序真机**：weapp 只做过构建验证，未在真机/开发者工具跑过。
- **老板端固定价**：按 ADR-0006，老板端不参与定价（固定价由商家端客服在选人时填）。
- **违约台账**：只读台账在商家端 Web（桌面），H5 没有入口。
- **报单时长对照**：在商家端 Web 的报单审批卡片上，H5 无审批入口。
- 生产环境（`h5.17ai.club`）尚未部署；本清单以本地一次性测试库为准。
