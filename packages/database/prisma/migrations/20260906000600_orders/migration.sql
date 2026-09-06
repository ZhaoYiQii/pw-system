-- Slice 5：需求确认与订单（主规格 10.1/11.3-11.5/12.1/14.2）
-- order_price_snapshots / order_events 不可变（无 updated_at）；outbox 与业务事务同写；幂等唯一(tenant,key,op)。
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT','CONFIRMED','DISPATCHING','ASSIGNED','READY','IN_PROGRESS','PENDING_CONFIRMATION','COMPLETED','CANCELLED');

CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "scheduled_start_at" TIMESTAMP(3) WITH TIME ZONE,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "remark" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_requirements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "game_id" UUID,
    "service_product_id" UUID,
    "gender" TEXT,
    "description" TEXT NOT NULL,
    "desired_start_at" TIMESTAMP(3) WITH TIME ZONE,
    "duration_seconds" INTEGER,
    "min_budget_fen" BIGINT,
    "max_budget_fen" BIGINT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "order_requirements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_price_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "snapshot_version" INTEGER NOT NULL,
    "service_product_id" UUID,
    "product_name" TEXT NOT NULL,
    "region_name" TEXT,
    "duration_seconds" INTEGER NOT NULL,
    "unit_price_fen" BIGINT NOT NULL,
    "player_cost_fen" BIGINT NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "line_total_fen" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_price_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "actor_type" TEXT,
    "actor_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processed_at" TIMESTAMP(3) WITH TIME ZONE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "response_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_tenant_id_order_no_key" ON "orders"("tenant_id", "order_no");
CREATE INDEX "orders_tenant_id_status_created_at_idx" ON "orders"("tenant_id", "status", "created_at");
CREATE INDEX "orders_tenant_id_customer_profile_id_created_at_idx" ON "orders"("tenant_id", "customer_profile_id", "created_at");
CREATE UNIQUE INDEX "order_requirements_tenant_id_order_id_key" ON "order_requirements"("tenant_id", "order_id");
CREATE UNIQUE INDEX "order_price_snapshots_tenant_order_version_product_key" ON "order_price_snapshots"("tenant_id", "order_id", "snapshot_version", "service_product_id");
CREATE INDEX "order_price_snapshots_tenant_id_order_id_idx" ON "order_price_snapshots"("tenant_id", "order_id");
CREATE INDEX "order_events_tenant_id_order_id_occurred_at_idx" ON "order_events"("tenant_id", "order_id", "occurred_at");
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");
CREATE UNIQUE INDEX "idempotency_records_tenant_id_key_op_key" ON "idempotency_records"("tenant_id", "idempotency_key", "operation");
CREATE INDEX "idempotency_records_tenant_id_entity_type_entity_id_idx" ON "idempotency_records"("tenant_id", "entity_type", "entity_id");

ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_requirements" ADD CONSTRAINT "order_requirements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_requirements" ADD CONSTRAINT "order_requirements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_requirements" ADD CONSTRAINT "order_requirements_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_requirements" ADD CONSTRAINT "order_requirements_product_id_fkey" FOREIGN KEY ("service_product_id") REFERENCES "service_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_price_snapshots" ADD CONSTRAINT "snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_price_snapshots" ADD CONSTRAINT "snapshots_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 金额/时长校验：快照行总额 = 单价*数量；数量>0；单价/成本非负
ALTER TABLE "order_price_snapshots" ADD CONSTRAINT "snapshots_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "order_price_snapshots" ADD CONSTRAINT "snapshots_unit_price_check" CHECK ("unit_price_fen" >= 0);
ALTER TABLE "order_price_snapshots" ADD CONSTRAINT "snapshots_line_total_check" CHECK ("line_total_fen" = "unit_price_fen" * "quantity");
ALTER TABLE "order_price_snapshots" ADD CONSTRAINT "snapshots_duration_check" CHECK ("duration_seconds" > 0);

-- RLS（租户级；outbox 允许 tenant_id 为 NULL 的平台事件）
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY; ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_requirements" ENABLE ROW LEVEL SECURITY; ALTER TABLE "order_requirements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_price_snapshots" ENABLE ROW LEVEL SECURITY; ALTER TABLE "order_price_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY; ALTER TABLE "order_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY; ALTER TABLE "idempotency_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY; ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "orders" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "order_requirements" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "order_price_snapshots" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "order_events" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "idempotency_records" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "outbox_events" FOR ALL TO pw USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation_runtime ON "orders" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "order_requirements" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "order_price_snapshots" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "order_events" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "idempotency_records" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "outbox_events" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true) OR tenant_id IS NULL)
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true) OR tenant_id IS NULL);