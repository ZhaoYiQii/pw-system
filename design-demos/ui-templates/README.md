# UI 开发模板路由索引

本目录是四端 UI 开发模板的唯一工作入口。开发任务先按"端口"找到对应模板，再在其基础上迭代设计或迁移生产代码；历史版本仍保留在 `design-demos/` 根目录作为存档。

## 端口路由表

| 端口 | 目录 | 入口模板 | 对应生产代码路径 | 说明 |
| --- | --- | --- | --- | --- |
| 商家端 | `ui-templates/merchant/` | `merchant-console-full.html` | `apps/admin-web/app/(tenant)` | 17 模块导航 + 四角色预览；`merchant-console-session-evidence.html` 为“场次与证据”详情模板参考 |
| 陪玩端 | `ui-templates/player/` | `player-mobile-v2.html` | `apps/mobile/src/pages/player/*` | H5/weapp 共用移动端，10 屏覆盖登录/接单/场次/收入/排班/争议/资料 |
| 老板端 | `ui-templates/boss/` | `boss-mobile-v3.html` | `apps/mobile/src/pages/customer/*` | H5/weapp 共用移动端，10 屏覆盖下单/选人/订单/钱包/争议/空状态 |
| 平台端 | `ui-templates/platform/` | `platform-console-v2.html` | `apps/admin-web/app/(platform)` | 平台登录 + 门店/开店/套餐/订阅/账号/审计 |

## 开发路由规则

1. 先判断任务属于哪个端口：商家端 / 平台端 = 桌面 Web；陪玩端 / 老板端 = 移动 H5 + 微信小程序。
2. 打开对应目录的“入口模板”查看当前视觉与模块状态，不要从旧存档随意开新分支。
3. 修改模板前先复制为新版本（如 `xxx-v4.html`），保留上一版可回看。
4. 生产迁移时按仓库 `AGENTS.md`：桌面端走 Next.js + Tailwind v4 + shadcn/ui；移动端走 Taro H5/weapp 与平台适配层。
5. 每次迁移/迭代按受影响端运行 typecheck / lint / build（移动端还需 `build:h5` 与 `build:weapp`）。

## 当前完成度

- 模块入口与第一版页面：四端齐全。
- 可生产迁移级详情：部分（订单/派单/场次证据已做详情）。
- 后端接口：真实接口为准；模板中标注“演示/待接”的部分未接入。
