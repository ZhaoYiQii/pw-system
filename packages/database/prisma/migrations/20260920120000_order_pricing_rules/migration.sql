-- 算价模型（ADR-0003 / 设计规格 v0.1 §5）：陪玩×游戏底价 + 按游戏绑定的加价规则库。
-- expand-only：只新增枚举、表、索引、约束与租户隔离策略，不删除也不改写任何旧结构——
-- game_dispatch_template_snapshots.rank_rules_json、game_dispatch_rank_rules 与模板字段选项里
-- 的旧加价字段全部保留为 legacy 只读（回退代码即恢复旧读路径）。
CREATE TYPE "GamePricingRuleItemKind" AS ENUM ('SURCHARGE', 'FIXED');

CREATE TABLE "player_game_prices" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "player_id" UUID NOT NULL,
  "game_id" UUID NOT NULL,
  "base_price_per_hour_fen" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "player_game_prices_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "game_pricing_rules" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "game_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_pricing_rules_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "game_pricing_rule_items" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "kind" "GamePricingRuleItemKind" NOT NULL DEFAULT 'SURCHARGE',
  "dimension_key" TEXT NOT NULL,
  "amount_fen" BIGINT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_pricing_rule_items_pkey" PRIMARY KEY ("id")
);

-- 唯一键：一个租户下每个陪玩×游戏只有一条底价；每个游戏只有一条规则（规则项挂在它下面）。
CREATE UNIQUE INDEX "pgp_tenant_player_game_key"
  ON "player_game_prices"("tenant_id", "player_id", "game_id");
CREATE INDEX "pgp_tenant_game_status_idx"
  ON "player_game_prices"("tenant_id", "game_id", "status");
CREATE UNIQUE INDEX "gpr_tenant_game_key"
  ON "game_pricing_rules"("tenant_id", "game_id");
CREATE UNIQUE INDEX "gpritem_tenant_rule_dim_key"
  ON "game_pricing_rule_items"("tenant_id", "rule_id", "dimension_key");
CREATE INDEX "gpritem_tenant_rule_sort_idx"
  ON "game_pricing_rule_items"("tenant_id", "rule_id", "sort_order");

-- 外键（Postgres 不自动索引外键列，逐个补上）。
ALTER TABLE "player_game_prices" ADD CONSTRAINT "player_game_prices_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_game_prices" ADD CONSTRAINT "player_game_prices_player_fkey"
  FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_game_prices" ADD CONSTRAINT "player_game_prices_game_fkey"
  FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_pricing_rules" ADD CONSTRAINT "game_pricing_rules_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_pricing_rules" ADD CONSTRAINT "game_pricing_rules_game_fkey"
  FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_pricing_rule_items" ADD CONSTRAINT "game_pricing_rule_items_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_pricing_rule_items" ADD CONSTRAINT "game_pricing_rule_items_rule_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "game_pricing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "player_game_prices_player_id_idx" ON "player_game_prices"("player_id");
CREATE INDEX "player_game_prices_game_id_idx" ON "player_game_prices"("game_id");
CREATE INDEX "game_pricing_rules_game_id_idx" ON "game_pricing_rules"("game_id");
CREATE INDEX "game_pricing_rule_items_rule_id_idx" ON "game_pricing_rule_items"("rule_id");

-- 金额一律整数分且非负；状态与命中键格式在数据库层兜底（命中键 = 字段标识=选项值）。
ALTER TABLE "player_game_prices" ADD CONSTRAINT "pgp_base_price_non_negative"
  CHECK ("base_price_per_hour_fen" >= 0);
ALTER TABLE "player_game_prices" ADD CONSTRAINT "pgp_status_check"
  CHECK ("status" IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE "game_pricing_rule_items" ADD CONSTRAINT "gpritem_amount_non_negative"
  CHECK ("amount_fen" >= 0);
ALTER TABLE "game_pricing_rule_items" ADD CONSTRAINT "gpritem_sort_order_non_negative"
  CHECK ("sort_order" >= 0);
ALTER TABLE "game_pricing_rule_items" ADD CONSTRAINT "gpritem_dimension_key_format"
  CHECK ("dimension_key" ~ '^[a-z][a-z0-9_]{0,63}=[^=[:space:]].*$');

ALTER TABLE "player_game_prices" ENABLE ROW LEVEL SECURITY; ALTER TABLE "player_game_prices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_pricing_rules" ENABLE ROW LEVEL SECURITY; ALTER TABLE "game_pricing_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_pricing_rule_items" ENABLE ROW LEVEL SECURITY; ALTER TABLE "game_pricing_rule_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "player_game_prices" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_pricing_rules" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_pricing_rule_items" FOR ALL TO pw USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation_runtime ON "player_game_prices" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_pricing_rules" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_pricing_rule_items" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
