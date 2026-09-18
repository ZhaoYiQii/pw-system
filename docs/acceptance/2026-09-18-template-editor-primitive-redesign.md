# 模板编辑器原语化重写 验收记录（2026-09-18 执行）

状态：**locally-verified**（本地代码 + 本地一次性测试库 + 真实本地 API 的 E2E；**未提交、未推送、未部署**）

范围：设计规格 v0.2 的 Task 1–5，外加实现过程中发现的 D-16 与三处缺口补齐。把商家端「内容设计」Tab 从「配置后端模型」改造成「用原语自由搭表单」，并删除全部预设入口。

依据：`docs/specs/派单模板表单设计器-设计规格-v0.2.md`、`docs/superpowers/plans/2026-09-18-template-editor-primitive-redesign.md`。

## 1. 数据库与迁移

| 项目 | 事实 |
| --- | --- |
| schema 变化 | **无**（纯前端切片，零 DDL） |
| 本轮是否执行迁移 | **否** |
| 使用的测试数据库 | `pw_saas_s2_task2_20260916`（本地 127.0.0.1:5433，一次性库，68 张表） |
| 未访问 | `pw_saas`、`pw_saas_test`、`pw_shadow`、`pw_saas_s1b_rehearsal_20260915_0428` |
| 夹具 | `work/s3-e2e-seed.mjs` seed / clean，退出码 0 / 0；结束时已清理（`cleaned tenant s3e2e`） |

## 2. 改动文件

| 文件 | 变更 | 行数 | Task |
| --- | --- | --- | --- |
| `apps/admin-web/app/_lib/merchant-console/template-editor-meta.ts` | 新增：标签、属性摘要、按组件统计问题数、算价占用判定 | 114 | 1 |
| `apps/admin-web/app/_lib/merchant-console/template-editor-meta.spec.ts` | 新增：16 个用例 | 236 | 1 |
| `apps/admin-web/app/_lib/merchant-console/template-editor-content.tsx` | 重写：原语化编辑器 + 展开属性面板 + 内嵌预览 + 编号联动 | 1155 | 2、3、D-16 |
| `apps/admin-web/app/_lib/merchant-console/template-form-renderer.tsx` | 改：可选编号 / 高亮 / hover 回调；预览文案去枚举 | 327 | D-16 |
| `apps/admin-web/app/_lib/merchant-console/template-draft-state.ts` | 改：`updateComponent` 支持 `placeholder`；新增 `reorderComponent` | 987 | 缺口补齐 |
| `apps/admin-web/app/_lib/merchant-console/template-draft-state-patch.spec.ts` | 新增：9 个用例（4 placeholder + 5 reorder） | 155 | 缺口补齐 |
| `apps/admin-web/app/_lib/merchant-console/template-manager-view.tsx` | 改：删除重复的草稿预览块与随之失效的 import | 1388 | 3 |
| `tests/e2e/merchant-console-admin.spec.ts` | 改：三条 S3 用例迁移到新 UI | 954 | 4 |

**工作树里还有大量与本次切片无关的既有未提交改动**（`dispatch-view.tsx`、`modules.ts`、`merchant-shell.tsx` 等），本次未触碰。

## 3. 与规格 / 计划的偏差

| # | 偏差 | 原因与处理 |
| --- | --- | --- |
| 1 | 「字段可平铺、分组可有可无」无法实现 | 真实模型 `addComponent(config, kind, sectionKey: string)` 要求分组必填。改为：没有分组时新建内容**自动建一个「表单内容」分组**，不再拦用户 |
| 2 | 「占位提示」原本无法编辑 | `updateComponent` 的补丁类型不含 `placeholder`。已给模型补上（200 字截断）+ 4 个用例 |
| 3 | 拖拽跨分组排序无法用既有 API 实现 | `moveComponent` 只能在同组内换相邻。新增 `reorderComponent(config, 被拖项, 目标项, before\|after)` + 5 个用例 |
| 4 | 重写时一度丢失「分组启用/停用」与折叠 | 自查发现，已补回（`updateSection({ enabled })` + 本地折叠状态） |
| 5 | 焦点回位原本失效 | `focusSelectorAfterMove` 依赖 `button[data-action="move-up"]`，重写后的按钮只有 aria-label。已补 `data-action` |
| 6 | 预设函数未删除 | 界面已不再调用 `insertPreset` / `DraftPreset`；按规格第 9 节，函数级删除作为独立清理任务 |

## 4. 验证证据（本轮重跑，均针对格式化后的最终代码）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `corepack pnpm --filter @pw/admin-web typecheck` | 0 | — |
| `corepack pnpm --filter @pw/admin-web build` | 0 | Compiled successfully |
| `corepack pnpm exec vitest run apps/admin-web/app/_lib/merchant-console` | 0 | **19 文件 / 139 用例全绿**（新增 25 个：16 meta + 9 patch） |
| `eslint`（本次改动 8 个文件） | 0 | 无输出 |
| `prettier --check`（同 8 个文件） | 0 | 先 `--write` 修 5 个文件；对比确认只格式化了本次新增代码（`template-manager-view.tsx` 未被改动） |
| `playwright test --project=admin … -g "S3 模板管理"`（含 `S3_E2E_SHOTS=1`） | 0 | **3 passed**（2.8s / 2.6s / 1.3s），含 D-16 的编号与联动断言 |

静态自检（编辑器）：`insertPreset` 0、`DraftPreset` 0、`参考预设` 0、`组件名称` 0、`fieldKey` 0、`S3 Task 4`（开发待办）0；`+ 新建字段/表格/说明/分组` 各 ≥1；`aria-pressed` 5 处；`data-action` 4 处。

D-16 的直接断言（本轮补上）：E2E 断言清单行编号 `data-row-number` 为 1/2、预览编号 `data-preview-number` 为 1，并断言悬停左侧第 2 行后**两侧同时命中高亮**（`ring-primary`）。

视觉基线（本轮补上）：`work/screenshots/template-editor.png`（152 KB，编辑态）与 `work/screenshots/template-editor-linking.png`（153 KB，联动高亮态），由 E2E 在 `S3_E2E_SHOTS=1` 时自动采集。

E2E 过程记录：第一次跑时键盘用例失败（`button[data-action="move-up"]` 超时），根因是补了 `data-action` 属性后忘了把文件落回仓库；落回后复跑 3 passed。

## 5. 未验证项

1. **有截图但无视觉回归机制**：`work/screenshots/` 下有两张自动采集的截图，但没有与基线逐像素对比的回归流程。
2. **人工走查由用户完成**：本地站点 `http://localhost:3005`（门店 `s3e2e` / `owner`），本轮交给用户审查。
3. **同文件其它 E2E 未运行**：它们依赖开发库 `pw_saas`，超出本次数据库授权范围。
4. **未提交、未推送、未部署**；也没有在 Linux 容器或生产环境验证。
5. **业务绑定与计算、发布设置与版本两屏未改**（规格第 9 节非目标）。

## 6. 环境与复现

```powershell
# 1) 依赖容器（本项目 compose；注意本机可能已有其它项目的 postgres/redis 在跑）
docker compose -f infra/docker/docker-compose.yml up -d postgres redis minio
# 2) 服务
$env:DATABASE_URL='postgresql://pw_runtime:pw_runtime_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
$env:PLATFORM_DATABASE_URL='postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
$env:SESSION_SECRET='s3-e2e-local-secret-0123456789-abcdefghij'
$env:PAYMENT_PROVIDER='mock'; $env:PORT='3100'
$env:ADMIN_WEB_ORIGIN='http://localhost:3005'; $env:H5_ORIGIN='http://127.0.0.1:3005'
node apps/api/dist/main.js                        # 仓库根目录
$env:NEXT_PUBLIC_API_ORIGIN='http://127.0.0.1:3100'
node node_modules/next/dist/bin/next dev -p 3005  # 工作目录 apps/admin-web
# 3) 夹具与 E2E
$env:DATABASE_URL='postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
node work/s3-e2e-seed.mjs seed
$env:ADMIN_ORIGIN='http://localhost:3005'
& '.\node_modules\.bin\playwright.cmd' test --project=admin tests/e2e/merchant-console-admin.spec.ts -g "S3 模板管理"
node work/s3-e2e-seed.mjs clean
```

收尾：夹具已清理；本次启动的 API(3100) 与 admin(3005) 进程已停止，端口已释放。`pw-saas-local` 的 postgres / redis / minio 容器保留运行。

## 7. 结论

「只给原语、不给预设」在代码层落地：界面不再出现任何预置字段目录或预置区块，四种新建动作全部从空白开始；属性集中在展开面板；预览与清单并排且共用编号；算价绑定保持可选且不暴露枚举。

状态为 **locally-verified**：代码已改、本地门禁与真实 API 的 E2E 均已通过。第 5 节的六项在完成前不应对外宣称「已验收完成」。

## 8. 视觉对齐（同日追加）

首版实现只做了结构与行为，视觉语言没有落地（控件被套进边框盒子、预览渲染成配置诊断视图、编号轴缺失）。已按规格第 10 节（D-20 / D-21）补齐：

| 改动 | 说明 |
| --- | --- |
| 预览改为客户视角 | `TemplateDraftRenderer` 重写呈现层：标签 + 输入框样式、选项胶囊（含 `+¥` 加价）、表格表头与行、说明块；删掉 `N 列`、`整行/半行`、类型枚举等诊断文案 |
| 安静的行 | 编辑器行去掉边框盒子，改为细线分隔 + 悬停/激活底色（CSS 层，作用于 `[data-template-editor] [data-component-key]`） |
| 编号轴 | 行内竖细线穿过编号方块，激活段变主色 |
| 分组与面板 | 分组改为轻分隔标题（不再是圆角卡片）；属性面板用 `--mc-paper-2` 浅底面板 |
| 金额换算抽为纯函数 | `yuanToFenString` / `fenToYuanInput` 移入 `template-editor-meta.ts`（不经过浮点），新增 3 个用例 |

验证：`typecheck` 0、`build` 0、单测 **19 文件 / 142 用例**全绿、E2E **3 passed**；截图重新采集（`work/screenshots/template-editor.png` 170 KB、`template-editor-linking.png` 171 KB）。

仍与原型有差距的地方：没有像素级视觉回归；预览容器尚未做成原型里的设备边框；页面标题字号来自既有的 `mc-pagehead`，未做调整。
## 9. 视觉返工（同日第二轮）

第一轮视觉对齐后仍被判定「和原型差太多、丑」。根因是**用了 shadcn 的 Button/Input 默认尺寸与 Tailwind 默认调色板，而不是商家端 token 与原型的视觉参数**。本轮按规格 D-22 / D-23 重做：

| 改动 | 说明 |
| --- | --- |
| 客户视角移入「渲染」弹层 | 去掉并排右栏；工具栏右侧新增「渲染」按钮，弹出客户视角弹层（填写表单 / 订单文案 / 手机宽度，Esc 或点遮罩关闭）。弹层用 `createPortal` 挂 body 并自带 `pw-merchant` 作用域 |
| 编辑器改单列 | 不再与预览分栏，清单占满宽度 |
| 按原型写样式 | 行的内边距 `8px 16px 8px 0`、分隔线左缩进 40px、编号方块 22×22、类型列 34px、名称 14px/500、工具 26×26、chip 高 28、面板左缩进 40px；工具栏按钮改自绘（虚线 36px，主操作实心） |
| 语义色改回 token | 必填 / 绑定 / 问题标签改用 `--mc-amber-*`、`--mc-accent-*`、`--mc-red-*`，不再用 Tailwind 的 `amber-100` 等默认色 |
| D-16 联动取消 | 客户视角在弹层里，两侧无法同屏，编号保留在清单；E2E 相应改为「点渲染 → 断言弹层内容 → 关闭」 |

验证：`typecheck` 0、`build` 0、单测 19 文件 / 142 用例全绿、E2E 3 passed；截图重新采集（`template-editor.png`、`template-editor-render.png`）。
## 10. 模板列表可隐藏（同日第三轮）

按用户要求，模板管理页左侧列表增加「隐藏 / 显示模板列表」开关（规格 D-24）：

| 项目 | 说明 |
| --- | --- |
| 按钮位置 | 页头，**在列表之外**——若放在列表内，隐藏后按钮一起消失、无法恢复 |
| 行为 | 隐藏时给布局容器加 `is-list-hidden`，CSS 把栅格降为单列并隐藏列表；按钮文案切为「显示模板列表」，带 `aria-pressed` / `aria-controls` |
| 效果 | 编辑区获得整行宽度（E2E 断言：隐藏后 `[data-template-editor]` 宽度大于隐藏前） |

验证：typecheck 0、build 0、E2E 3 passed（含新增宽度断言）、prettier / eslint 0。
## 11. 像素级视觉回归（同日第四轮）

补齐第 5 节第 1 条「有截图但无回归机制」：

| 项目 | 说明 |
| --- | --- |
| 机制 | Playwright `toHaveScreenshot` 快照比对，基线落在 `tests/e2e/merchant-console-admin.spec.ts-snapshots/` |
| 范围 | 只截 `[data-template-editor]` 本体与「渲染」弹层。**不能整页截图**：用例里的模板名带时间戳，全页每次都不同（首次尝试整页快照即失败，已改为元素级） |
| 参数 | `animations: "disabled"` 关动画、`maxDiffPixels: 150` 容忍抗锯齿差异 |
| 证据 | 基线生成退出码 0；紧接着不带 `--update-snapshots` 的比对退出码 0（3 passed），说明基线与当前渲染一致 |

仍未完成（各自需要授权或设计）：

1. **同文件其它 E2E（已尝试，仍未通过）**：这些用例假定开发库里存在特定门店（代码 `c1`）及其数据。本轮把 `scripts/seed-dev.mjs` 灌进授权的一次性库（生成的门店是 `demo`），并把 `loginAsOwner` 的门店 code 参数化为 `E2E_TENANT_CODE`（默认仍 `c1`，不改变既有行为），用 `demo` 跑全套——前三条立即失败（其中两条各耗 60 秒超时），已中止，避免继续空耗。结论：这批用例需要**专属夹具**（像 `work/s3-e2e-seed.mjs` 之于 S3 那样）或开发者本地开发库，属独立任务。
2. **提交 / 推送 / 部署**：仓库规则要求这三件事各自单独授权。
3. **另外两屏**（业务绑定与计算、发布设置与版本）：需要先出设计；不属于本规格范围。