-- 算价模型 Task 4（设计规格 §3.5 / §5 / §9 第 3 条）：陪玩放鸽子/未到场的人工违约记录。
--
-- expand-only：只新增表、索引、约束与租户隔离策略，不删除也不改写任何旧结构。
-- 该表是只增不改的事件型记录（无 updated_at/version）：外键只到 tenants，
-- 档位被「释放名额」或后续清理后记录仍然保留，供统计与通知留痕使用。
-- 运行时角色授权依赖迁移 1 的 ALTER DEFAULT PRIVILEGES（pw 创建的表自动授权 pw_runtime）。

CREATE TABLE "player_breach_records" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "player_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "order_slot_id" UUID,
  "reason" TEXT NOT NULL,
  "recorded_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "player_breach_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pbr_tenant_player_created_idx"
  ON "player_breach_records"("tenant_id", "player_id", "created_at");
CREATE INDEX "pbr_tenant_order_idx"
  ON "player_breach_records"("tenant_id", "order_id");

ALTER TABLE "player_breach_records" ADD CONSTRAINT "player_breach_records_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 违约理由必填：服务层校验为主，数据库层兜底（纯空白同样拒绝）。
ALTER TABLE "player_breach_records" ADD CONSTRAINT "pbr_reason_not_blank"
  CHECK (btrim("reason") <> '');

ALTER TABLE "player_breach_records" ENABLE ROW LEVEL SECURITY; ALTER TABLE "player_breach_records" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "player_breach_records" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "player_breach_records" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
