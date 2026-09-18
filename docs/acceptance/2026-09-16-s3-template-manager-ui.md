# S3 通用派单模板管理界面验收记录（2026-09-16 计划 · 2026-09-16 执行）

状态：**locally-verified**（本地代码 + 本地一次性测试库 + 真实本地 API 的 E2E 证据齐全；未提交、未推送、未部署）

范围：S3 Task 0–7。把 `/merchant-console/dispatch/templates` 从只读演示页升级为正式模板管理界面：列表/筛选/URL 状态、内容设计编辑器、业务绑定与计算、发布与版本历史、无障碍与键盘操作，并用真实本地 S2 API 跑通主路径与并发冲突路径。

## 1. 数据库与迁移

| 项目 | 事实 |
| --- | --- |
| schema 变化 | **无**（S3 只消费 S2 已交付的 API） |
| 本轮是否执行迁移 | **否** |
| 使用的测试数据库 | `pw_saas_s2_task2_20260916`（本地 127.0.0.1:5433，一次性库） |
| 未访问 | `pw_saas`、`pw_saas_test`、`pw_shadow`、S1b 演练库、任何远程库 |
| 夹具 | `work/s3-e2e-seed.mjs` 创建固定门店 `s3e2e`（owner / 游戏「英雄联盟 E2E」）；E2E 结束后已执行 `clean`，库内无残留 |
| 回滚方式 | 界面可回退到列表只读态（隐藏编辑与发布入口）；已发布版本不可变，不涉及 down migration |

## 2. 契约 operation 清单（界面唯一数据入口）

前缀 `/api/v1/tenant/game-dispatch-templates`，共 12 条 operation，全部为 S2 交付；S3 **未新增、未修改**契约：

| Method | Path | operationId | 界面用途 |
| --- | --- | --- | --- |
| GET | `/` | `genericGameTemplate_list` | 列表 + 筛选 + 游标分页 |
| POST | `/` | `genericGameTemplate_create` | 新建模板 |
| GET | `/{id}/draft` | `genericGameTemplate_getDraft` | 打开编辑器草稿 |
| PATCH | `/{id}/draft` | `genericGameTemplate_saveDraft` | 保存草稿（expectedRevision） |
| POST | `/{id}/publish` | `genericGameTemplate_publish` | 发布版本（含 changeNote） |
| GET | `/{id}/versions` | `genericGameTemplate_listVersions` | 版本历史 |
| POST | `/{id}/restore` | `genericGameTemplate_restore` | 历史版本还原为草稿 |
| POST | `/{id}/copy` | `genericGameTemplate_copy` | 复制为独立草稿 |
| POST | `/{id}/default` | `genericGameTemplate_setDefault` | 设为默认模板 |
| POST | `/{id}/archive` | `genericGameTemplate_archive` | 归档 |
| POST | `/{id}/unarchive` | `genericGameTemplate_unarchive` | 取消归档 |
| DELETE | `/{id}` | `genericGameTemplate_remove` | 删除（仅未发布且无引用） |

界面只通过生成客户端调用（`apps/admin-web/app/_lib/merchant-console/template-api.ts`），不手写 URL、不手写响应类型。

## 3. 变更文件

| 文件 | 作用 |
| --- | --- |
| `apps/admin-web/package.json` | 增加 `@pw/api-client: workspace:*` |
| `apps/admin-web/next.config.ts` | `transpilePackages: ["@pw/api-client"]` |
| `apps/admin-web/app/globals.css` | `--mc-accent` 由 `#189c91` 调为 `#11786f`（对比度达 AA，见 §5/§9） |
| `packages/api-client/package.json` | `main`/`types`/`exports`（`.` 与 `./client`）+ `build` 脚本 |
| `packages/api-client/tsconfig.build.json` | 生成客户端产出 `dist`（类型入口） |
| `apps/admin-web/app/(tenant)/merchant-console/dispatch/templates/page.tsx` | 页面入口（Suspense 包裹，承接 URL 状态） |
| `.../merchant-console/template-api.ts`(+spec) | 生成客户端封装：baseUrl 装配、Authorization 注入、错误码映射 |
| `.../template-list-state.ts`(+spec) | 列表 URL 状态（游戏/状态/搜索/排序/选中/标签）解析与序列化 |
| `.../template-draft-state.ts`(+spec) | 草稿镜像类型、装箱/拆箱、插入预设、删除守卫、即时校验 |
| `.../form-layout.ts` / `form-layout-v2.spec.ts` | v2 装箱布局（与派单共享渲染） |
| `.../template-form-renderer.tsx` | 草稿渲染器（预览/复用布局） |
| `.../template-editor-content.tsx` | 内容设计编辑器（区块/组件/列/默认行） |
| `.../template-binding.ts`(+spec) | 人数来源候选、选项加价、校验问题定位 |
| `.../template-editor-binding.tsx` | 业务绑定与计算面板 |
| `.../template-document-preview.ts`(+spec) | 按当前草稿生成表格与纯文本文案 |
| `.../template-a11y.ts`(+spec) | 键盘移动后的焦点恢复与 aria-live 播报文案 |
| `.../template-manager-view.tsx` | 列表 + 编辑器 + 发布/版本/生命周期主视图 |
| `tests/e2e/merchant-console-admin.spec.ts` | S3 E2E（3 用例） |
| `work/s3-e2e-seed.mjs` | 一次性夹具脚本（只允许 `pw_saas_s2_task2_20260916`） |

## 4. 环境与计划偏差

| 项目 | 计划假设 | 实际执行 |
| --- | --- | --- |
| API 端口 | 3000 | **3100**（本机 3000 被无关服务占用），因此 `NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3100` |
| admin 端口 | 3005 | 3005（与计划一致） |
| admin 访问域名 | — | 必须用 `localhost:3005`；Next 16 默认拦截跨源 dev 资源，`127.0.0.1:3005` 会导致 `/_next/*` 被拦、页面不水合 |
| CORS | — | 仅当 API 设置 `ADMIN_WEB_ORIGIN=http://localhost:3005` 时才为浏览器请求开启 |
| API 启动参数 | — | `DATABASE_URL`/`PLATFORM_DATABASE_URL` 均指向测试库，`PAYMENT_PROVIDER=mock`，`SESSION_SECRET` 为测试值 |

## 5. 验证证据（命令 / 退出码）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `corepack pnpm --filter @pw/admin-web typecheck` | 0 | — |
| `corepack pnpm --filter @pw/admin-web build` | 0 | 生产构建通过；`/merchant-console/dispatch/templates` 为静态预渲染页 |
| `vitest run --config vitest.config.ts apps/admin-web/app/_lib/merchant-console apps/api/src/modules/game-dispatch/domain` | 0 | 19 文件 / 127 测试 |
| `eslint`（merchant-console 目录 + S3 E2E spec） | 0 | — |
| `prettier --check`（S3 改动文件 + 本文档） | 0 | — |
| `git diff --check` | 0 | 仅有 `packages/database/prisma/schema.prisma` 的既有 CRLF 警告，与 S3 无关 |
| 对比度复核（WCAG 相对亮度公式，本地 Node 脚本） | 0 | `--mc-accent=#11786f`：白字 **5.33:1**；纸面 5.33 / `--mc-paper-2` 5.05 / `--mc-accent-2` 4.72 / `--mc-bg` 4.91，均达 AA |
| 渲染实拍（headless Chromium 读 `getComputedStyle`） | 0 | 主操作按钮实测 `rgb(17, 120, 111)`（= `#11786f`）配白字；实拍 `work/accent-after-dialog.png`、`work/accent-after-editor.png`（1440×960） |
| `playwright test --project=admin tests/e2e/merchant-console-admin.spec.ts -g "S3 模板管理"` | 0 | 3 用例通过（真实本地 API + 一次性测试库） |

## 6. E2E 覆盖

跑在真实本地 API 上（非 mock），夹具门店 `s3e2e`：

1. **主路径**：登录 → 新建模板 → 加分区 → 插入「岗位与人数」参考预设（断言组件名与列）→ 业务绑定页断言人数来源已绑定为「表格列汇总」→ 保存草稿（`草稿已保存 · rN`）→ 填发布备注 → 发布（`已发布 vN`）→ 版本行 `v1` 带备注 → 文案预览出现 `【新分区】` 与默认行 `人数：1` → 归档后保存/发布按钮禁用 → 取消归档 → 再保存草稿 → 详情区状态变为「有未发布改动」。
2. **并发冲突**：两个浏览器上下文用同一门店账号；A 保存（r2）后 B 保存推进服务端 revision；A 再保存必须出现 409 冲突块（「另一个管理员刚保存过…」+「你的改动还在本地，不会被自动覆盖。」+「重新加载服务端」按钮），且 A 的本地草稿仍在（新增字段未丢失）。
3. **键盘**：用 `+ 字段` 建两个字段后，键盘聚焦第二个字段的上移按钮并回车，断言提示、顺序变化，且焦点仍停留在同一组件（`data-component-key` 不变）。

## 7. 数据库落库证据

E2E 结束时（清理前）对一次性库的只读查询：

```
select name, status, revision, archived_at is not null as archived,
       active_version_id is not null as published
from game_dispatch_templates order by created_at;

         name          |  status  | revision | archived | published
-----------------------+----------+----------+----------+-----------
 E2E 排位陪练 <id>     | ARCHIVED |        4 | t        | t
 E2E 键盘 <id>         | DRAFT    |        1 | f        | f

select version_no, change_note, published_by,
       jsonb_array_length(config_json::jsonb -> 'components') as components
from game_dispatch_template_versions order by version_no;

 version_no | change_note  |             published_by             | components
------------+--------------+--------------------------------------+------------
          1 | E2E 首次发布 | 6c547de7-...                         |          1
```

说明：主路径用例的归档→取消归档→再保存让 revision 走到 4；发布快照确实落库（含发布人、备注与组件），不是纯前端状态。

## 8. Task 7 期间发现并修复的缺陷

| 缺陷 | 影响 | 修复 |
| --- | --- | --- |
| `configureTemplateClient` 从未被调用（计划 Task 1 的装配点在实现时漏接） | 生成单例保持默认相对 baseUrl，所有模板请求打到 admin 自身 origin 并 404，界面完全不可用；同时不带 Authorization | 在 `template-api.ts` 模块加载处完成装配（`NEXT_PUBLIC_API_ORIGIN` + 每次请求实时读取 token） |
| 数据基线的 effect（依赖 `id:revision`）同时 `setNotice("")` | 保存/发布/归档的成功提示在同一帧被清空，用户看不到确认，`aria-live` 也不再播报 | 只在切换模板时清空提示；revision 变化仍重置草稿基线 |
| E2E 断言与实现不一致（人数来源在绑定页、版本行 `v1` 与详情卡 `v1` 重名、文案预览为 `【区块名】` 而非 `【下单信息】`、归档提示与筛选下拉重名） | 用例假失败，无法作为验收证据 | 修正断言；给版本行加 `data-version-no` 钩子（与既有 `data-component-key`/`data-section-key` 约定一致） |

## 9. 未验证项与降级

- **未跑视觉回归**：没有截图基线比对，界面视觉仅由模式 A/C 的原型确认稿与人工评审背书。
- **未验证深色模式与真机触控**：E2E 只在 headless 桌面视口下运行。
- **其他既有 E2E 未运行**：`tests/e2e/admin.spec.ts`、`tests/e2e/mobile.spec.ts` 依赖开发库 `pw_saas`，超出本次数据库授权，未执行。
- **冲突用例的收敛路径未端到端验证**：已证明 409 冲突块出现、本地草稿保留、「重新加载服务端」按钮存在；未验证点击后在真实并发下合入的最终结果。
- **契约缺口：`game=unclassified`**：列表契约 `gameId` 只接受 uuid，无法用参数表达「未归类」，界面只在已加载结果内筛选；如需要服务端语义，需改契约（需单独批准）。
- **生成契约的判别字段：已解决（2026-09-17）**。生成脚本新增归一化：20 处内联 oneOf 的成员提升为 6 个 components/schemas 具名组件并改写为 $ref + discriminator.mapping，判别字段的 const 归一化为单值 enum（该生成器只认 enum）。结果：types.gen.ts 的 `kind: string` 从 60 处降到 0、`kind: 'FIELD'` 等字面量 36 处，联合变成 Array<TemplateFieldComponentV2 | TemplateTableComponentV2 | TemplateNoteComponentV2>。证据：契约套件 18 通过（含 $ref+mapping 与字面量断言）、api/api-client/admin typecheck 全 0。
- **生成契约的判别字段**：oneOf 未生成 discriminator，生成类型把判别字段渲染为 `kind: string`；admin 用精确镜像类型 + 编译期兼容断言规避，根治需修改生成器（属契约变更，需批准）。
- **主操作色对比度：已修复**。`--mc-accent` 由 `#189c91`（白字 3.39:1）改为 `#11786f`；白字 5.33:1，作为文字在 `--mc-paper` / `--mc-paper-2` / `--mc-accent-2` / `--mc-bg` 上分别为 5.33 / 5.05 / 4.72 / 4.91:1，全部达 AA（复核见 §5）。排除项：`#0f7f76` 在 `--mc-accent-2` 上仅 4.31:1，未达 AA。
- **移动端同一问题未处理**：`apps/mobile/src/components/player-ui/styles.css` 的 `--pw-primary: #189c91` 与本次同值，白字同样约 3.39:1；属另一个 app 的视觉决策，未在 S3 授权范围内改动，建议单独开任务。
- **夹具已清理**：一次性库中的 `s3e2e` 门店已删除，复现需重新执行夹具脚本。

## 10. 复现步骤

```powershell
# 1) 依赖与本地服务（API 3100 / admin 3005）
docker compose -f infra/docker/docker-compose.yml up -d postgres
$env:DATABASE_URL='postgresql://pw_runtime:pw_runtime_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
$env:PLATFORM_DATABASE_URL='postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
$env:SESSION_SECRET='s3-e2e-local-secret-0123456789-abcdefghij'
$env:PAYMENT_PROVIDER='mock'; $env:PORT='3100'
$env:ADMIN_WEB_ORIGIN='http://localhost:3005'; $env:H5_ORIGIN='http://127.0.0.1:3005'
node apps/api/dist/main.js            # 工作目录 apps/api
$env:NEXT_PUBLIC_API_ORIGIN='http://127.0.0.1:3100'
node node_modules/next/dist/bin/next dev -p 3005   # 工作目录 apps/admin-web

# 2) 夹具
$env:DATABASE_URL='postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
node work/s3-e2e-seed.mjs seed

# 3) E2E（必须用 localhost:3005）
$env:ADMIN_ORIGIN='http://localhost:3005'
& '.\node_modules\.bin\playwright.cmd' test --project=admin tests/e2e/merchant-console-admin.spec.ts -g "S3 模板管理"

# 4) 收尾
node work/s3-e2e-seed.mjs clean
```

## 11. 结论

S3 的界面能力（列表与 URL 状态、内容设计、业务绑定与计算、保存/发布/版本历史/恢复/复制/默认/归档/删除、409 冲突处理、无障碍与键盘操作）已在本地真实 API 上端到端验证，门禁全部通过（typecheck / build / 单测 / lint / format / E2E）。状态为 **locally-verified**：代码已改、本地已验证；**未提交、未推送、未部署**，且 §9 的降级项在完成前不应对外宣称「已验收完成」。