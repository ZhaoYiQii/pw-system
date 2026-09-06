-- Slice 4：客户、陪玩与服务目录（主规格 11.2/10.5/8.2）
-- 金额 bigint 分；时长 integer 秒；租户业务表带 tenant_id 并启用/强制 RLS。
-- 运行时角色授权依赖迁移 1 中 ALTER DEFAULT PRIVILEGES（pw 创建的表自动授权 pw_runtime）。

-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable customer_profiles
CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "remark" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable player_profiles
CREATE TABLE "player_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "intro" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "accepting_orders" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "player_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable games
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable game_regions
CREATE TABLE "game_regions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "game_regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable service_products
CREATE TABLE "service_products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "game_region_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "service_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable pricing_rules
CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "service_product_id" UUID NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "price_fen" BIGINT NOT NULL,
    "player_cost_fen" BIGINT NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable player_skills
CREATE TABLE "player_skills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "game_region_id" UUID,
    "title" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "player_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable player_availability
CREATE TABLE "player_availability" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "ends_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "player_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_tenant_id_mobile_key" ON "customer_profiles"("tenant_id", "mobile");
CREATE INDEX "customer_profiles_tenant_id_idx" ON "customer_profiles"("tenant_id");
CREATE UNIQUE INDEX "player_profiles_tenant_id_mobile_key" ON "player_profiles"("tenant_id", "mobile");
CREATE INDEX "player_profiles_tenant_id_idx" ON "player_profiles"("tenant_id");
CREATE UNIQUE INDEX "games_tenant_id_name_key" ON "games"("tenant_id", "name");
CREATE INDEX "games_tenant_id_idx" ON "games"("tenant_id");
CREATE UNIQUE INDEX "game_regions_tenant_id_game_id_name_key" ON "game_regions"("tenant_id", "game_id", "name");
CREATE INDEX "game_regions_tenant_id_game_id_idx" ON "game_regions"("tenant_id", "game_id");
CREATE UNIQUE INDEX "service_products_tenant_id_game_id_name_key" ON "service_products"("tenant_id", "game_id", "name");
CREATE INDEX "service_products_tenant_id_game_id_idx" ON "service_products"("tenant_id", "game_id");
CREATE INDEX "service_products_tenant_id_game_region_id_idx" ON "service_products"("tenant_id", "game_region_id");
CREATE UNIQUE INDEX "pricing_rules_tenant_id_service_product_id_duration_key" ON "pricing_rules"("tenant_id", "service_product_id", "duration_seconds");
CREATE INDEX "pricing_rules_tenant_id_service_product_id_idx" ON "pricing_rules"("tenant_id", "service_product_id");
CREATE UNIQUE INDEX "player_skills_tenant_id_player_id_game_id_key" ON "player_skills"("tenant_id", "player_id", "game_id");
CREATE INDEX "player_skills_tenant_id_player_id_idx" ON "player_skills"("tenant_id", "player_id");
CREATE INDEX "player_skills_tenant_id_game_id_idx" ON "player_skills"("tenant_id", "game_id");
CREATE INDEX "player_availability_tenant_id_player_id_starts_at_idx" ON "player_availability"("tenant_id", "player_id", "starts_at");

-- AddForeignKey (业务表 → tenants；业务父表引用为单列 FK，租户归属由 RLS + 服务层校验共同保证)
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "games" ADD CONSTRAINT "games_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_regions" ADD CONSTRAINT "game_regions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_regions" ADD CONSTRAINT "game_regions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_products" ADD CONSTRAINT "service_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_products" ADD CONSTRAINT "service_products_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_products" ADD CONSTRAINT "service_products_game_region_id_fkey" FOREIGN KEY ("game_region_id") REFERENCES "game_regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_service_product_id_fkey" FOREIGN KEY ("service_product_id") REFERENCES "service_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_skills" ADD CONSTRAINT "player_skills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_skills" ADD CONSTRAINT "player_skills_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_skills" ADD CONSTRAINT "player_skills_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_skills" ADD CONSTRAINT "player_skills_game_region_id_fkey" FOREIGN KEY ("game_region_id") REFERENCES "game_regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_availability" ADD CONSTRAINT "player_availability_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_availability" ADD CONSTRAINT "player_availability_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 金额/时长/时间不变量（主规格 10.5：金额整数分、非负成本、非零时长、结束晚于开始）
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_price_fen_check" CHECK ("price_fen" > 0);
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_player_cost_fen_check" CHECK ("player_cost_fen" >= 0);
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_duration_seconds_check" CHECK ("duration_seconds" > 0);
ALTER TABLE "player_availability" ADD CONSTRAINT "player_availability_ends_after_starts_check" CHECK ("ends_at" > "starts_at");

-- ===== Slice 4 追加：RLS（租户级）=====
ALTER TABLE "customer_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "player_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "player_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "games" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "games" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_regions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_regions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_products" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pricing_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pricing_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "player_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "player_skills" FORCE ROW LEVEL SECURITY;
ALTER TABLE "player_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "player_availability" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "customer_profiles" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "player_profiles" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "games" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_regions" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "service_products" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "pricing_rules" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "player_skills" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "player_availability" FOR ALL TO pw USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation_runtime ON "customer_profiles" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "player_profiles" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "games" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_regions" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "service_products" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "pricing_rules" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "player_skills" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "player_availability" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));