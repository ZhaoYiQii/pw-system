# 陪玩门店多租户 SaaS

本目录用于建设面向多家陪玩门店销售的多租户 SaaS。第一期目标为平台运营后台、门店后台和客户/陪玩 H5，并要求同一移动端代码持续兼容未来独立微信小程序。

当前只完成项目治理初始化，尚未生成或运行应用。

## 给开发者与 AI

开始任何工作前依次阅读：

1. `AI_START_HERE.md`
2. `AGENTS.md`
3. `PROJECT_STATUS.md`
4. `docs/specs/陪玩门店多租户SaaS-H5-开发主规格-v1.0.md`

不得跳过规格直接创建项目，也不得一次实现多个 Slice。

## 计划中的技术方向

主规格确定的方向包括 TypeScript Monorepo、Next.js 管理后台、NestJS 模块化单体 API、Taro React 移动端、PostgreSQL、Redis、对象存储，以及 H5/weapp 双构建。准确 patch 版本必须在 Slice 0 获得依赖安装授权后依据官方来源锁定。

## 本地与生产目标

- 本地：Windows + Docker Desktop（Linux containers）。
- 构建与运行目标：Linux 容器。
- 生产：Linux 服务器；部署属于后续独立授权，不包含在初始化中。

