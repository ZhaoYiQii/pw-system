# 生产部署手册（H1 起步版）

目标：腾讯云 Ubuntu 24.04 单机 + Docker Compose 起步；Postgres/Redis 与应用同机。
对外 HTTPS 由系统 Caddy 反代；只监听回环的应用端口不直接暴露公网。

> 目录中同时存在本地 `infra/docker/docker-compose.yml`，所有生产命令必须显式带
> `-f docker-compose.prod.yml`（下述 `ENV_FILE` 已包含）。

## 目录布局

- `/srv/pw-saas/pw-system`：仓库克隆
- `/srv/pw-saas/.env`：生产环境变量（不入库，mode 600）
- `/srv/pw-saas/backup/`：Caddyfile 等备份与数据库导出

## 首次部署

```bash
sudo mkdir -p /srv/pw-saas
cd /srv/pw-saas
git clone https://github.com/ZhaoYiQii/pw-system.git pw-system
cd pw-system/infra/docker
ENV_FILE=(-f docker-compose.prod.yml --env-file /srv/pw-saas/.env)

# 准备 /srv/pw-saas/.env（复制 env.prod.example 并填入强随机值）
docker compose "${ENV_FILE[@]}" --profile init build api pw-init admin h5

# 1) 起数据库依赖
docker compose "${ENV_FILE[@]}" up -d postgres redis
docker compose "${ENV_FILE[@]}" ps

# 2) 建库引导（owner 连接，必须在迁移之前）：
#    迁移 20260906000100_tenancy 内含 `ALTER DEFAULT PRIVILEGES FOR ROLE pw IN SCHEMA public`，
#    假定对象 owner 名为 `pw`；生产 owner 是 `pw_saas` 时整条迁移会以
#    `role "pw" does not exist`（P3018 / SQLSTATE 42704）失败——P2 冒烟实测。
#    脚本在仓库 infra/docker/bootstrap-owner.sql（已挂载到容器 /opt/pw-saas/）。
docker compose "${ENV_FILE[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -f /opt/pw-saas/bootstrap-owner.sql

# 3) 迁移（owner 连接；迁移自身会创建 pw_runtime 与 RLS 策略）
docker compose "${ENV_FILE[@]}" run --rm pw-init \
  sh -c 'cd /app/packages/database && DATABASE_URL=$DATABASE_MIGRATION_URL \
  node node_modules/prisma/build/index.js migrate deploy --config prisma7.config.ts'

# 4) 把 pw_runtime 密码改为生产随机值（迁移里是硬编码开发口令）
#    注意：这一步不做，api 会在登录时 500「database credentials for pw_runtime are not valid」。
docker compose "${ENV_FILE[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER ROLE pw_runtime PASSWORD '$PW_RUNTIME_PASSWORD';"

# 5) 运行时授权补齐（owner 连接；可重复执行）：
#    owner=pw_saas 时，迁移内的 `FOR ROLE pw` 默认权限不会作用到 pw_saas 新建的表，
#    P2 冒烟实测：64 张带 tenant_isolation_runtime 策略的表里只有 2 张对 pw_runtime 可读；
#    执行本步后恢复 64/64（本地 owner=pw 的库天然就是 64/64，所以本地开发看不出来）。
docker compose "${ENV_FILE[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -f /opt/pw-saas/grant-runtime.sql

# 6) 初始化演示数据（owner 连接；显式覆盖 DATABASE_URL 避免 RLS 拒绝）
docker compose "${ENV_FILE[@]}" run --rm pw-init \
  sh -c 'DATABASE_URL=$DATABASE_MIGRATION_URL node /app/scripts/seed-prod.mjs'
docker compose "${ENV_FILE[@]}" run --rm pw-init \
  sh -c 'DATABASE_URL=$DATABASE_MIGRATION_URL node /app/scripts/seed-store-demo.mjs'

# 7) 起应用并核对健康
docker compose "${ENV_FILE[@]}" up -d
docker compose "${ENV_FILE[@]}" ps
curl -fsS http://127.0.0.1:4100/ready
```

> 密码中的 `$`/`@`/`:` 需避免或 URL 编码。正式多租户运营时，应删除演示种子数据并改用
> 平台端“一键开店”开通真实门店。

## P2 本机 Linux 容器冒烟记录（2026-09-21）

在同机 Docker（Docker Desktop，Linux 容器）+ 一次性项目 `pw-saas-smoke` + 一次性卷上，
按上面 1)–7) 的顺序跑通，结果：

| 步骤 | 结果 |
| --- | --- |
| 构建 `pwsaas/api:prod`、`pwsaas/admin:prod`、`pwsaas/h5:prod` | 成功（首次修复 Dockerfile.admin 缺 `packages/api-client`） |
| 1) postgres/redis | 均 healthy |
| 2) bootstrap-owner.sql | `DO`，无报错 |
| 3) `migrate deploy` | `All migrations have been successfully applied`（35 条） |
| 4) `ALTER ROLE pw_runtime` | 未做时登录 500（凭据无效）；做了之后登录 200 |
| 5) grant-runtime.sql | 覆盖率 2/64 → **64/64**（SELECT/INSERT），可重复执行 |
| 6) 两个种子脚本 | `seed-prod ok`、`store demo seed ok` |
| 7) `up -d` | api healthy、admin/h5/worker Up、postgres/redis healthy |
| 冒烟 | `/health`、`/ready` 均 200（database/redis up）；商家端 4200 真浏览器登录 → `/merchant-console/work` 渲染真实数据；H5 4300 首页 200；H5 nginx `/api` 反代登录 200；CORS 预检对 `ADMIN_WEB_ORIGIN` 返回 204 |

同轮发现并已修（都在本仓库）：

1. `Dockerfile.admin` build 阶段未拷 `packages/api-client` → admin 镜像构建 `module not found`；
2. `compose.prod.yml` 未传 `SMS_PROVIDER`/`ALLOW_MOCK_SMS` → api 容器崩溃循环
   `mock sms is not allowed in production`，admin/h5 因依赖不健康连带起不来（默认仍 fail-closed，
   演示部署在 `.env` 显式 `ALLOW_MOCK_SMS=true`）；
3. 首次建库缺 `pw` 角色引导与运行时授权补齐 SQL（现已入库为两个 `.sql` 并挂载到 postgres 容器）。

仍未验证：真实托管 PostgreSQL / 对象存储 / 生产短信支付 Provider / 生产主机本身（均属后续项）。

## Caddy 站点块（追加到 /etc/caddy/Caddyfile，先备份）

```caddyfile
api.17ai.club {
    reverse_proxy 127.0.0.1:4100
}

admin.17ai.club {
    reverse_proxy 127.0.0.1:4200
}

h5.17ai.club {
    reverse_proxy 127.0.0.1:4300
}
```

## 回滚

- 恢复 `/srv/pw-saas/backup/Caddyfile.bak` 并 `systemctl reload caddy`
- `docker compose -f docker-compose.prod.yml --env-file /srv/pw-saas/.env down`
  （保留卷；彻底删除用 `down -v`）
- 既有 `openclaw`/`lingxi-bot` 服务不受本目录影响

## 待办（接入托管 PostgreSQL 后更新）

- 替换 POSTGRES_* 与 DATABASE_URL* 为腾讯云托管连接串，删除本地 postgres 服务
- 对象存储接入后证据文件从本地卷迁移 S3 兼容桶
- 真实支付 Provider 替换 mock（移除 ALLOW_MOCK_PAYMENT=true）
