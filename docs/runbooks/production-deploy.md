# 生产部署手册（H1 起步版）

目标：腾讯云 Ubuntu 24.04 单机 + Docker Compose 起步；Postgres/Redis 与应用同机。
对外 HTTPS 由系统 Caddy 反代；只监听回环的应用端口不直接暴露公网。

## 目录布局

- `/srv/pw-saas/pw-system`：仓库克隆
- `/srv/pw-saas/.env`：生产环境变量（不入库）
- `/srv/pw-saas/backup/`：Caddyfile 等备份与数据库导出

## 首次部署

```bash
sudo mkdir -p /srv/pw-saas
cd /srv/pw-saas
git clone https://github.com/ZhaoYiQii/pw-system.git pw-system
cd pw-system/infra/docker
# 准备 /srv/pw-saas/.env（复制 env.prod.example 并填入强随机值）
docker compose --env-file /srv/pw-saas/.env build
# 迁移（owner 连接；migration 会幂等创建 pw_runtime 等角色/策略）
docker compose --env-file /srv/pw-saas/.env run --rm pw-init \
  sh -c 'cd /app/packages/database && DATABASE_URL=$DATABASE_MIGRATION_URL node /app/node_modules/prisma/build/index.js migrate deploy --config prisma7.config.ts'
# 迁移完成后把 pw_runtime 密码改为生产随机值并同步到 .env 的 PW_RUNTIME_PASSWORD/DATABASE_URL
docker compose --env-file /srv/pw-saas/.env exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER ROLE pw_runtime PASSWORD '$PW_RUNTIME_PASSWORD';"
# 初始化演示数据（owner 连接）
docker compose --env-file /srv/pw-saas/.env run --rm pw-init \
  sh -c 'DATABASE_URL=$DATABASE_MIGRATION_URL SEED_PLATFORM_PASSWORD="$SEED_PLATFORM_PASSWORD" SEED_TENANT_PASSWORD="$SEED_TENANT_PASSWORD" node /app/scripts/seed-prod.mjs'
docker compose --env-file /srv/pw-saas/.env run --rm pw-init \
  sh -c 'DATABASE_URL=$DATABASE_MIGRATION_URL SEED_TENANT_CODE="$SEED_TENANT_CODE" node /app/scripts/seed-store-demo.mjs'
docker compose --env-file /srv/pw-saas/.env up -d
```

> 注意：容器内 `DATABASE_URL` 由 compose 注入 runtime 连接串；上述 init 命令显式用
> owner 连接覆盖，避免 RLS 拒绝建演示数据。密码中的 `$`/`@`/`:` 需避免或 URL 编码。

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
- `docker compose --env-file /srv/pw-saas/.env down`（保留卷；彻底删除用 `down -v`）
- 既有 `openclaw`/`lingxi-bot` 服务不受本目录影响

## 待办（接入托管 PostgreSQL 后更新）

- 替换 POSTGRES_* 与 DATABASE_URL* 为腾讯云托管连接串，删除本地 postgres 服务
- 对象存储接入后证据文件从本地卷迁移 S3 兼容桶
- 真实支付 Provider 替换 mock（移除 ALLOW_MOCK_PAYMENT=true）
