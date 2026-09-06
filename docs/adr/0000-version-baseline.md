# ADR-0000：Slice 0 版本基线

- 状态：已批准（用户于 2026-09-06 对 Slice 0 全量授权，主规格 v1.0 作为实现基线）
- 背景：主规格第 4 章要求所有依赖使用精确 patch 版本；Slice 0 在取得依赖安装授权后依据官方 registry 解析并锁定。
- 约束：`package.json` 禁止 `^`/`~`/`latest`/`*`；`pnpm-lock.yaml` 为唯一依赖事实源；Node 由 `.nvmrc`、`.node-version`、`package.json#engines` 三处一致声明 24.x。
- 版本解析方法：`pnpm view <spec> version` 查询官方 registry（本机 npm CLI 缓存目录受限，统一使用 pnpm 查询与安装）。

## 解析结果（2026-09-06，官方 registry）

| 依赖 | 锁定版本 | 来源命令 |
|---|---|---|
| Node.js（CI/目标） | 24.20.0 | nodejs.org/dist/index.json（24.x 最新 LTS） |
| pnpm | 10.34.5 | pnpm view pnpm@10 version |
| TypeScript | 5.9.3 | pnpm view typescript@5 version |
| Turborepo | 2.10.12 | pnpm view turbo@2 version |
| Vitest | 3.2.7 | pnpm view vitest@3 version |
| ESLint | 9.39.5 | pnpm view eslint@9 version |
| @eslint/js | 9.39.5 | pnpm view @eslint/js@9 version |
| typescript-eslint | 8.69.0 | pnpm view typescript-eslint@8 version |
| Prettier | 3.9.6 | pnpm view prettier@3 version |
| @types/node | 24.13.3 | pnpm view @types/node@24 version |
| Next.js | 16.3.4 | pnpm view next@16 version |
| React / react-dom | 19.2.8 | pnpm view react@19 version |
| @types/react | 19.2.18 | pnpm view @types/react@19 version |
| @types/react-dom | 19.2.7 | pnpm view @types/react-dom@19 version |
| @nestjs/core / common / platform-express / testing / swagger | 12.0.1 | pnpm view @nestjs/core@12 version（同族同版本） |
| @nestjs/cli | 12.0.0 | pnpm view @nestjs/cli@12 version |
| reflect-metadata | 0.2.2 | pnpm view reflect-metadata@0.2 version |
| rxjs | 7.8.2 | pnpm view rxjs@7 version |
| supertest | 7.2.2 | pnpm view supertest@7 version |
| @types/supertest | 7.2.1 | pnpm view @types/supertest version |
| @tarojs/*（cli/taro/components/helper/react/runtime/shared/plugin-framework-react/plugin-platform-h5/plugin-platform-weapp/webpack5-runner/taro-loader/babel-preset-taro） | 4.2.1 | pnpm view @tarojs/cli@4 version |
| webpack | 5.91.0 | pnpm view webpack@5.91 version |
| @babel/core / preset-react / runtime | 7.29.7 | pnpm view @babel/core@7 version |
| postcss | 8.5.28 | pnpm view postcss@8 version |
| tsconfig-paths-webpack-plugin | 4.2.0 | pnpm view tsconfig-paths-webpack-plugin@4 version |
| @types/webpack-env | 1.18.8 | pnpm view @types/webpack-env version |

## 计划基线、暂不在 Slice 0 安装（随所属切片安装并追加锁定）

| 依赖 | 计划版本（解析于 2026-09-06） | 所属切片 |
|---|---|---|
| Zod | 4.5.4 | Slice 1+ |
| Prisma / @prisma/client | 7.10.0 | Slice 1 |
| BullMQ | 5.81.4 | Slice 9 |
| ioredis | 5.11.1 | Slice 9 |
| @playwright/test | 1.63.0 | Slice 5+（E2E） |

## 容器镜像（compose，本地开发）

`postgres:18`、`redis:7`、`minio/minio:latest`。精确 patch 待 Docker Desktop 启动并 `docker pull` 验证后在本 ADR 追加记录；未验证前不声称固定。

## 本地偏差（明确记录，不得静默）

- 本机 Node 为 v24.14.0，低于规格基线 24.15+。Slice 0 在 24.14.0 上完成本地验证属于降级证据；CI 使用 `.nvmrc`（24.20.0）满足基线。升级本机 Node 到 24.15+ 需单独授权，未包含在本次批准内。
- 本机 pnpm 全局为 11.x，与基线 10.x 不一致。项目通过 `packageManager: pnpm@10.34.5` + corepack 固定为 10.34.5；全局 pnpm 版本不影响仓库内命令。

## 验证证据

- `pnpm view <spec> version` 输出见上方来源命令（2026-09-06 执行，退出码 0）。
- 安装、构建与测试证据以 `docs/acceptance/slice-0-acceptance.md` 为准。

## 影响

后续任何依赖升级必须单独成任务并更新本 ADR，禁止夹带在功能切片内。升级 Prisma 到 8.x 属于架构迁移，需独立设计。

## 回滚

依赖回滚 = 修改 `package.json` 精确版本并重新生成 lockfile；Node/pnpm 版本策略见上方本地偏差。本 ADR 不涉及数据迁移，无数据回滚。

## ADR-0000 增补（2026-09-06，安装后证据修正）

- 发现冲突：主规格第 162 行 Mobile 基线写 "Taro 4 + React 19"，但官方 registry 最新 Taro 4.2.1 的 peer 依赖仅支持 `react@^18` 与 `@types/react@^18`（`@tarojs/react@4.2.1` → `react-reconciler@0.29.0` peer `react@^18.2.0`）。安装命令输出 peer 警告为证。
- 决定：`apps/mobile` 锁定 `react@18.3.1`、`react-dom@18.3.1`、`@types/react@18.3.31`；`apps/admin-web`（Next.js 16）保持 `react@19.2.8` 满足主规格第 160 行。
- 影响：移动端 React 大版本与规格顶层（第 7 行 React 19）不一致，属已记录偏差。待 Taro 官方发布支持 React 19 的版本后，作为独立升级任务回归主规格，不得夹带在业务切片中。
- 恢复：修改 `apps/mobile/package.json` 的 react/react-dom/@types/react 版本并重新生成 lockfile。
## ADR-0000 增补 2（2026-09-06，docker compose pull 后证据）

本地开发容器镜像（compose，已拉取）：`postgres:18`（image id 4ef4dbc939d6）、`redis:7`（image id 71da9275c5f3）、`minio/minio:latest`（image id 14cea493d9a3）。精确 patch 由镜像 digest 锁定于本地；生产镜像 tag 策略需在部署切片单独批准。
## ADR-0000 增补 3（2026-09-06，降级项处理证据）

- 本机 Node 已由用户批准升级：`winget upgrade OpenJS.NodeJS.LTS` 退出码 0，本机 Node 24.14.0 → 24.19.0。原“本地偏差”中 Node 低于 24.15 一项**已解决**（24.19.0 ≥ 24.15 且为 LTS）；CI 目标仍为 `.nvmrc` 的 24.20.0，两端同属 24.x。
- 本地开发容器已启动：`docker compose up -d` 退出码 0；postgres:18 卷挂载路径按官方 18+ 要求修正为 `/var/lib/postgresql`（原 `/var/lib/postgresql/data` 会触发镜像启动保护）。
- 新增根 devDependency：`@playwright/test@1.63.0`（用于 H5 渲染验证；E2E 套件仍按规格属 Slice 5+，本项仅安装浏览器与依赖，未创建测试套件）。
- React 大版本偏差（mobile React 18.3.1）仍有效：Taro 全系最新 4.2.1 peer 仅 `react@^18`（registry 实证），等待上游支持后作为独立升级任务回归主规格。