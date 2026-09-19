# 验收记录：客户自助下单 v2（通用派单模板）

- 日期：2026-09-19
- 分支：`feat/generic-dispatch-template-manager`（基线 `47b5c5b`，远端已同步）
- 范围：Task 4（H5 页面升级与 v1 回退）+ Task 5（契约已生成、门禁收口、E2E、验收记录）
- 状态：**代码已改 + 本地已验证**；未提交、未推送、未部署、未做 Linux 容器验证
- 规格：`docs/superpowers/specs/2026-09-19-customer-self-service-v2-order-design.md`（C-1…C-11）
- 计划：`docs/superpowers/plans/2026-09-19-customer-self-service-v2-order.md`（Task 1–5、§9 排序修正）

## 1. 本次新增/修改

| 区域 | 文件 |
| --- | --- |
| API 新路由 | `apps/api/src/modules/game-dispatch/interface/customer-game-template.controller.ts`（`GET customer/games`） |
| API 应用/领域 | `application/generic-game-template.service.ts`、`domain/game-template-published-read.ts`（`selectPublishedGames` + `PUBLISHED_GAME_LIMIT`） |
| API 持久化 | `infrastructure/prisma-generic-game-template.repository.ts`（按游戏去重 + 回查游戏名） |
| API 契约 | `openapi/schemas.ts`、`common/validation/api-validation-rules.ts`、`openapi.yaml/json`、`packages/api-client/src/*` |
| H5 页面 | `apps/mobile/src/pages/customer/game-order/index.tsx`（四步 + v1 回退） |
| H5 逻辑 | `apps/mobile/src/features/customer-ui/order-values.ts`、`order-intent.ts`（+ 两个 spec） |
| H5 平台/样式 | `platform/contracts/api-transport.ts`（可选 `headers`）、`platform/h5/api-adapter.ts`、`components/customer-ui/styles.css` |
| 测试 | `tests/integration/game-dispatch-template-order.spec.ts`（客户只读入口 +1 例）、`tests/contract/game-dispatch-template-v2.spec.ts`（operationId 与响应形状 +1 断言）、`apps/api/.../game-template-published-read.spec.ts`（+4 例） |

## 2. 命令与退出码（本次实跑）

| 命令 | 退出码 | 关键输出 |
| --- | --- | --- |
| `node node_modules/vitest/vitest.mjs run apps/api/src/modules/game-dispatch/domain/game-template-published-read.spec.ts` | 0 | 1 file / 11 tests passed |
| `node node_modules/vitest/vitest.mjs run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-template-order.spec.ts` | 0 | 1 file / 23 tests passed（基线 22 + 新增 1） |
| `node node_modules/vitest/vitest.mjs run --config tests/vitest.contract.config.ts` | 0 | 4 files / 20 tests passed |
| `node node_modules/vitest/vitest.mjs run` | 0 | 45 files / 291 passed，1 skipped |
| `corepack pnpm --filter @pw/mobile typecheck` | 0 | `tsc --noEmit` 无输出 |
| `corepack pnpm --filter @pw/mobile build:h5` | 0 | compiled successfully（1 个既有的 entrypoint size warning） |
| `corepack pnpm --filter @pw/mobile build:weapp` | 0 | Compiled successfully in 4.27s |
| `corepack pnpm openapi:generate` | 0 | openapi.yaml/json + api-client 重生成，client typecheck 通过 |
| `node work/h5v2-smoke.mjs` | 0 | `H5 v2 smoke OK`（见 §4） |
| `node node_modules/@playwright/test/cli.js test --project=admin tests/e2e/merchant-console-admin.spec.ts -g "S3" --update-snapshots` | 0 | 3 passed；`template-editor-admin-win32.png` 重生成 |
| 同上（不带 `--update-snapshots`） | 0 | 3 passed |
| `node node_modules/prettier/bin/prettier.cjs --check <本次改动文件>` | 0 | 全部符合（另：既有文件 `prisma-game-template.repository.ts` 仍不合规，本次未改） |

集成测试的环境前提（一次性库，不用开发库）：

```
PW_TEST_MIGRATION_URL=postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public
DATABASE_URL=PW_TEST_RUNTIME_URL=postgresql://pw_runtime:pw_runtime_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public
PLATFORM_DATABASE_URL=<migration url>
PAYMENT_PROVIDER=mock
```

E2E 的环境前提：`ADMIN_ORIGIN=http://localhost:3005`、`S3_E2E_TENANT_CODE=s3e2e`（admin dev 直连 3100 API，3100 已指向一次性库）。

## 3. 契约、权限与安全边界检查点

- **端口由入口决定（C-1 / C-9）**：`games` / `published` / `versions/{id}/form` / `template-orders` 四条路由同族，均 `@RequireAddon(addon.game_dispatch_template_v2)` + `@Permissions("order.manage")` + 角色必须为 `CUSTOMER`；请求体里**没有**端口声明字段，也没有 `customerProfileId`（客户档案由登录身份推导）。
- **契约断言**：`customerGameTemplate_listGames/listPublished/getVersionForm/createOrder` 四个 operationId 稳定；games 响应只含 `gameId` + `name`；下单请求带 `idempotency-key` 头。
- **边界校验**：`GET customer/games` 无查询参数（`strictObject` 空对象）；`published` 缺 `gameId` 即 400；`values` 只接受对象，未知键由服务端 422。
- **幂等（C-8）**：客户入口与客服入口使用不同的 idempotency operation 值；H5 按「一次意图一个键」复用（`order-intent.ts`），提交成功后换键。
- **丢弃与必填（C-5 / C-6 / V-10）**：不可见字段的值被丢弃并记 `template.field_values_dropped`；客户侧不因 CS-only 必填受阻（集成用例覆盖）。
- **值口径**：NUMBER→`number`、MONEY_FEN→整数分字符串、DATETIME→带时区 ISO、SINGLE/MULTI_SELECT→选项值（数组）、表格 NUMBER 列→`number`；前端本地转换与服务端一致（`order-values.ts` 单测覆盖）。
- **租户隔离**：所有查询以服务端绑定的 `tenantId` 为第一参数；跨租户模板/版本按不存在处理。

## 4. H5 冒烟（真实 API + 真实 build:h5 产物 + msedge headless）

一次性脚本（`work/`，不入库）：

- `work/h5v2-smoke-seed.mjs`：在一次性库创建专用租户 `h5v2smoke`（v2 addon + 老板自助 addon + `owner`/`boss` 账号与客户档案 + 一个游戏）
- `work/h5v2-smoke.mjs`：经真实 API 建模板并发布（v1），再驱动浏览器完成 登录 → 选游戏 → 选模板 → 填表 → 提交
- `work/h5v2-smoke-serve.mjs`：3101 托管 `apps/mobile/dist` 并把 `/api` 代理到临时 API 3110（H5 dev server 的 `/api` 写死代理 3100 旧构建，且 `TARO_APP_API_BASE` 不会被内联）

结果（`work/screenshots/h5-v2-smoke-result.json`）：

```json
{
  "orderId": "962db0cd-b3a3-48d7-8b57-49ae1a019648",
  "templateVersionId": "33692a30-e095-4188-9a7e-198f421d1c80",
  "staffingTotal": 1,
  "priceAdjustmentFen": "1500",
  "documentHasRegion": true,
  "documentHasInternalNote": false,
  "idempotencyKeyLength": 36,
  "idempotencyKeyUnique": true,
  "consoleErrors": []
}
```

断言要点：表单里不出现 CS-only 的「内部备注」（界面与订单文案都不含）；成功页显示的「1 人 / ¥15.00」与服务端返回一致；提交请求带 36 位 `Idempotency-Key`；控制台零报错（唯一 404 是本地未绑 host 的 `public/tenant-resolve`，属预期）。

截图：`work/screenshots/h5-v2-smoke-{1-game,2-template,3-form,4-done}.png`

冒烟期间发现并修复的问题：`v2Step` 推导漏了 `gameId`，选完游戏后停在「选择游戏」、模板步骤不可达；修复后重跑通过（修复后重跑 typecheck / build:h5 / build:weapp / 冒烟）。

## 5. 未验证 / 降级 / 待确认

1. **weapp 运行态未验证**：只做了构建（小程序 AppID 与请求域名未配置）。
2. **未做 Linux 容器验证**，因此不声称可部署。
3. **`GET customer/games` 不过滤 `games.enabled=false`**：与既有「按游戏读已发布模板」保持同一口径，待产品确认是否要收紧。
4. **原型表单里的实时人数/加价汇总未实现**：客户端不得算价（规格 C-9），改为提交后展示服务端返回值。
5. **未发送 `durationMinutes` / `desiredStartAt`**：接口可选，客户侧一次填写一次提交（C-11）。
6. **商家端 `template-order-form.tsx` 把 NUMBER 当字符串提交**：若模板人数来源是数字字段会 422；本片未改，另立小切片。
7. **一次性库遗留数据**：`h5v2smoke` 租户（tenantId `2c5a8288-9672-4079-ac5b-da80b5e12690`，含冒烟模板与 3 张冒烟订单）、`work/` 下 3 个一次性脚本与 4 张截图均未入库；可按 tenantId 精确清理。
8. **未提交、未推送**。

## 6. 回滚方式

- 前端：还原 `apps/mobile/src/pages/customer/game-order/index.tsx`、`features/customer-ui/order-values.ts`、`order-intent.ts`、`components/customer-ui/styles.css`、`platform/*` 两处改动；或直接关闭 v2 addon —— 页面按 C-7 自动回到经典（v1）下单流程。
- API：移除 `customer/games` 路由与 `listPublishedGames` 链路并重新生成契约；零 DDL、零数据迁移；已建订单与快照保留。
- 契约：`openapi.yaml/json` 与 `packages/api-client/src` 随 `pnpm openapi:generate` 重生成即可回到加性变更前的形状。


## 7. 试跑发现的既有问题（已修复，2026-09-19 追加）

- `tests/tenant-isolation/game-dispatch-template-order.spec.ts` 4 例失败：`PrismaClientValidationError: Invalid tx.idempotencyRecord.findUnique() invocation — Argument `operation` is missing`。
- 根因（systematic-debugging 定位）：Task 3 给 `CreateTemplateOrderCommand` 增加了必需的 `operation`，
  但这支用例的 `command()` 构造器（第 197-217 行）仍是旧签名，只给到 `tenantId/actorId/idempotencyKey/input/requestHash`；
  于是仓库的 `idempotencyWhere()` 拿到 `operation: undefined`，Prisma 复合唯一键缺参数直接抛 `PrismaClientValidationError`。
- 修复：用例的 `command()` 补 `operation: TEMPLATE_ORDER_OPERATION_BY_AUDIENCE.CS`（走客服侧入口，与用例语义一致），
  常量从 service 导入以保持与产品边界同步；不动产品代码（把 `operation` 设为可选会削弱 C-8 的双入口区分，正是要防的）。
- 修复后实跑：`tests/vitest.tenant-isolation.config.ts` → **11 文件 / 36 用例全绿**（原 4 红）；`vitest run` 45 文件 / 291 通过；契约 4 文件 / 20 通过；eslint 该文件退出码 0。
- 已完成（2026-09-19 追加）：测试纳入 typecheck —— 新增 `tests/tsconfig.json`（contract / tenant-isolation / e2e / integration 四块，0 错误）并接入根 `typecheck` 脚本；顺带修掉集成用例 24 条类型宽松，以及 `ledger-invariants` 里"无效查询 + catch 兜底"掩盖口径的写法（改为显式按门店取账目 + TODO 账目↔订单关联）。

- 本回合实跑：`tests/vitest.tenant-isolation.config.ts` → 11 文件、32 通过 / 4 失败（仅在上述文件）。eslint（本次改动 5 个文件）退出码 0；admin typecheck 因沙箱无法写 tsbuildinfo 未取到结果。

## 8. UI 修复轮次（2026-09-19 追加，两轮）

两轮都用「真实浏览器测量」定位而不是肉眼判断：脚本 `work/ui-audit.mjs`（一次性，不入库），
截图 `work/screenshots/ui-audit-{before,after,before2,after2}-form.png`，原始测量 `ui-audit-*.json`。

### 8.1 输入框横向溢出（根因：box-sizing 没命中）

- 现象：表单里输入框冲出卡片、贴到屏幕边缘。
- 根因：`box-sizing: border-box` 写在 `View/Text/Button/Input/Textarea` 这些 HTML 标签选择器上；
  H5 下 Taro 把它们渲染成 `taro-*-core` 自定义元素，构建产物里 `taro-input-core` 命中数为 **0**，规则等于失效，
  于是 `width:100%` + 两侧 11px padding + 1px 边框按 `content-box` 撑出容器。
- 实测（375 宽）：`taro-input-core` 宽 337px、右边界 368px，父容器内容右边界 344px → **溢出 24px**；5 个被测元素 3 个溢出。
- 修复：`components/customer-ui/styles.css` 的 box-sizing 规则补上 `taro-view-core / taro-text-core / taro-button-core / taro-input-core / taro-textarea-core`。
- 修后：溢出元素 **3 → 0**。

### 8.2 表单字号层级（根因：标签与说明同质感）

- 实测修前：字段标签 11px / 400 / 灰（与 10px 提示同一层级），卡片标题 15px / 700 → 层级断裂。
- 修复：新增 `.cu-field-label`（12px / 600 / 正文色）、`.cu-required`（主题色星号）、`.cu-field-note`（10px 次级灰）；字段与表格列标签统一用这套。

### 8.3 输入框文字不垂直居中

- 实测修前：宿主 `taro-input-core` 高 38px，内层 `input` 仅 18.4px 且宿主 `display:block` → 上间隙 1px / 下间隙 18.6px，文字贴顶。
- 修复：`taro-input-core.cu-input { display:flex; align-items:center }` + 内层 input 归零 padding/border、字体继承。
  该规则只写在 `taro-*-core` 上，weapp 不命中，不影响小程序原生 input。
- 修后：上/下间隙 **9.8px / 9.8px**。

### 8.4 可重复表格排版

- 现象：每行被做成竖排小卡片，行高 196px，行内重复渲染「位置 */人数 *」两份标签，"第 N 行"标题与字段标题同权重。
- 修复：改为「表头一行 + 数据行」的表格形态（表头承担列名，行内只留输入件）；数字列固定 78px，末列 56px 放等高方形删除按钮。
- 修后：数据行高 **196px → 55px**。

### 8.5 修复后复验

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `corepack pnpm --filter @pw/mobile typecheck` | 0 | 无输出 |
| `corepack pnpm --filter @pw/mobile build:h5` | 0 | compiled successfully（既有 size warning） |
| `corepack pnpm --filter @pw/mobile build:weapp` | 0 | Compiled successfully |
| `node work/ui-audit.mjs after2` | 0 | 溢出 0；输入框上下间隙 9.8/9.8；表格行高 55px |
| `node work/h5v2-smoke.mjs` | 0 | `H5 v2 smoke OK`，控制台零报错 |
| `pnpm openapi:generate`（重跑） | 0 | 契约产物逐文件哈希不变（生成幂等） |
| `corepack pnpm --filter @pw/admin-web typecheck` | 0 | 无输出 |

未验证：其它客户页未逐页复测（共用类受益但未逐页测量）；weapp 仅构建、未跑真机。
