# 项目状态

- 项目：陪玩门店多租户 SaaS
- 规格版本：v1.0（2026-09-06 用户确认作为实现基线）
- 状态日期：2026-09-06
- 当前阶段：Slice 0 已实施（本地验证完成，降级项已处理），等待 Slice 1
- 业务代码：未开始（仅骨架与健康接口）
- Slice 0：已实施；六条验收命令全部退出 0；H5 渲染已验证
- 依赖：已安装（pnpm 10.34.5 经 corepack 固定；含根 devDependency @playwright/test 1.63.0）
- Git 仓库：已初始化；提交 `97e2dcc` + `36dd26c` + 本次降级项处理提交
- Node：本机 24.19.0（≥24.15，满足基线）；CI 目标 24.20.0（.nvmrc）
- Docker：Docker Desktop 运行中；postgres:18 / redis:7 / minio 容器已启动，postgres、redis healthy
- 数据库：容器已启动但未建库、未迁移（Slice 1 引入）
- H5：构建通过；Playwright Chromium 渲染验证页面显示 runtime=h5 / H5_ADAPTER
- 微信小程序：weapp 构建通过（含 WECHAT_ADAPTER，无 h5 标记）；未提交、未发布
- Linux 容器验证：未执行（Dockerfiles 与容器化属后续切片）
- 云服务与真实密钥：未配置

## 状态更新记录（必须带证据）

- 2026-09-06 | Slice 0：lint/typecheck/test/build/build:h5/build:weapp 全部退出 0；git init + 提交；docker compose pull/up 退出 0。
- 2026-09-06 | 降级项处理：winget 升级 Node→24.19.0（exit 0）；docker compose up -d（exit 0，三容器运行）；Playwright Chromium H5 渲染验证通过（runtime=h5/H5_ADAPTER，无控制台错误）；六条验收命令在 24.19.0 下重跑全绿。

## 下一允许动作

Slice 1（租户开通与隔离）需用户明确授权后实施；涉及 packages/database（Prisma 7 + PostgreSQL RLS）、tenancy 模块、host/短码解析与租户隔离测试。数据库迁移与建库需单独授权。

## 范围决策记录（2026-09-06，用户明确）

1. **小程序开发暂缓**：第一期推进期间不做微信小程序“开发/真机/审核/发布”；保留 `pnpm build:weapp` 作为兼容性编译门禁（防止移动端源码破坏双端可移植性），该门禁已全绿。Slice 13 与 weapp 增值服务相关工作整体后移，需另行授权。
2. **mobile React 大版本**：接受 mobile 使用 React 18.3.1 作为当前基线（Taro 4.2.1 上游仅支持 react@^18），React 19 升版挂起，待 Taro 上游支持后作为独立任务；admin-web 保持 React 19.2.8。详见 ADR-0000。
3. **远程仓库**：未提供远程地址与鉴权前，不执行任何 push/上传源码；CI workflow 仅在本地等价命令维度验证。