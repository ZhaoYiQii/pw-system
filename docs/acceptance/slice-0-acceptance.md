# Slice 0 验收记录

- 规格版本：主规格 v1.0（2026-09-06 用户确认作为实现基线）
- 切片：Slice 0 — 仓库骨架与双端可构建基线
- 提交：`97e2dcc`（首次提交）；本记录与状态文件更新在随后的 docs 提交
- 状态日期：2026-09-06
- 执行环境：Windows；Node v24.14.0（本地偏差，见 ADR-0000）；pnpm 10.34.5（corepack 固定）；Docker Desktop 29.7.2（Linux 引擎已启动）

## 验收命令与退出码（本机实际执行）

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `pnpm lint` | 0 | eslint . 无错误 |
| `pnpm typecheck` | 0 | turbo run typecheck：@pw/api、@pw/worker、@pw/admin-web、@pw/mobile 4 任务成功 |
| `pnpm test` | 0 | vitest：3/3 通过（worker typed-unsupported、health controller 单测、GET /health e2e 200） |
| `pnpm build` | 0 | turbo run build：api/worker tsc 产出 dist；admin-web `next build` 成功（静态生成 /） |
| `pnpm build:h5` | 0 | Taro v4.2.1 webpack5 编译成功；H5 产物含 `H5_ADAPTER`=1、`WECHAT_ADAPTER`=0 |
| `pnpm build:weapp` | 0 | Taro weapp 编译成功；weapp 产物含 `WECHAT_ADAPTER`=1、`H5_ADAPTER`=0；app.json pages/window 正确 |

`docker compose pull`：退出码 0。镜像：`postgres:18`（id 4ef4dbc939d6）、`redis:7`（id 71da9275c5f3）、`minio/minio:latest`（id 14cea493d9a3）。

## 人工检查与未验证项

- H5 “显示 runtime=h5”：已由产物标记 `H5_ADAPTER` + 页面渲染代码路径证明；未做浏览器渲染验证（浏览器 E2E 属后续切片）。
- weapp：仅“微信小程序构建通过”（符合规格：无真实 AppID 时不得声称实机验证或已上线）。
- Node 本地 24.14.0 < 基线 24.15+：本地验证属降级证据；CI 目标 24.20.0（.nvmrc）。
- 容器：仅拉取镜像，未执行 `docker compose up`（未授权启动会改变数据的容器）。
- CI：workflow 已创建，未在远程运行（无远程仓库）。
- test:critical / test:integration / test:tenant-isolation / test:contract / test:e2e / openapi:* / db:* 为 `not-implemented` 占位（exit 1），按计划由对应切片实现，Slice 0 不声称其可用。
- React 大版本偏差：mobile 使用 React 18.3.1（Taro 4.2.1 peer 仅支持 ^18），admin-web 保持 React 19.2.8；见 ADR-0000 增补。

## 结论

Slice 0 六条验收命令全部退出 0，状态为 **code-changed + locally-verified**。不代表已部署、已提交小程序或已生产验证。

## 第二轮补充验证（2026-09-06，用户批准全部降级项处理）

- Node 升级：`winget upgrade OpenJS.NodeJS.LTS` 退出码 0，本机 Node 24.14.0 → **24.19.0**（≥24.15，满足基线；winget LTS 清单当前为 24.19.0）。六条验收命令在 24.19.0 下重跑全部退出 0，engine 警告消失。
- Docker 容器：`docker compose up -d` 退出码 0；修正 postgres:18 卷挂载为 `/var/lib/postgresql` 后，postgres/redis/minio 均运行中，postgres、redis 为 healthy。
- H5 真实渲染验证：Playwright Chromium（@playwright/test 1.63.0，加入根 devDependencies）。headless Chromium 打开 H5 产物，页面文本 = `runtime=h5adapter=H5_ADAPTER`；断言 `runtime=h5`=true、`H5_ADAPTER`=true、`WECHAT_ADAPTER`=false、控制台错误=[]，退出码 0。
- 原“未验证项”中：Node 偏差（已解决）、H5 浏览器渲染（已解决）、容器未启动（已解决）。