-- D3：每租户至多一条 ACTIVE 订阅；历史重复 ACTIVE 数据仅保留最新一条（按 created_at/ends_at）。
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id
           ORDER BY created_at DESC, ends_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM tenant_subscriptions
  WHERE status = 'ACTIVE'
)
UPDATE tenant_subscriptions
SET status = 'SUPERSEDED', ends_at = COALESCE(ends_at, now())
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_subscriptions_one_active_per_tenant"
  ON "tenant_subscriptions"("tenant_id")
  WHERE status = 'ACTIVE';
