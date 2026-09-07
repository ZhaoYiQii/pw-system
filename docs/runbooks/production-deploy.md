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

# 迁移（owner 连接；migration 幂等创建 pw_runtime/pw 等角色与策略）
docker compose "${ENV_FILE[@]}" run --rm pw-init \
  sh -c 'cd /app/packages/database && DATABASE_URL=$DATABASE_MIGRATION_URL \
  node node_modules/prisma/build/index.js migrate deploy --config prisma7.config.ts'

# 迁移成功后把 pw_runtime 密码改为生产随机值并同步到 .env 的 PW_RUNTIME_PASSWORD
docker compose "${ENV_FILE[@]}" exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER ROLE pw_runtime PASSWORD '$PW_RUNTIME_PASSWORD';"

# 生产 owner 授权（首次建库/重建库必须；迁移内 ALTER DEFAULT PRIVILEGES FOR ROLE pw
# 假定本地 owner 名为 pw，而生产 owner 是 pw_saas）：
# 1) 若不存在 pw 角色则 CREATE ROLE pw NOLOGIN; 并 GRANT pw TO pw_saas;
# 2) 对含 tenant_isolation_runtime 策略的全部表 GRANT DML TO pw_runtime；
# 3) ALTER DEFAULT PRIVILEGES FOR ROLE pw_saas ... TO pw_runtime。
# 完整 SQL 已保存为 /srv/pw-saas/backup/grant_runtime.sql（可用 psql -f 重放）。

# 初始化演示数据（owner 连接；显式覆盖 DATABASE_URL 避免 RLS 拒绝）
docker compose "${ENV_FILE[@]}" run --rm pw-init \
  sh -c 'DATABASE_URL=$DATABASE_MIGRATION_URL node /app/scripts/seed-prod.mjs'
docker compose "${ENV_FILE[@]}" run --rm pw-init \
  sh -c 'DATABASE_URL=$DATABASE_MIGRATION_URL node /app/scripts/seed-store-demo.mjs'

docker compose "${ENV_FILE[@]}" up -d
```

> 密码中的 `$`/`@`/`:` 需避免或 URL 编码。正式多租户运营时，应删除演示种子数据并改用
> 平台端“一键开店”开通真实门店。

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
