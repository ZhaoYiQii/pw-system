-- Block1：陪玩运营模块（Game Dispatch）
-- 只新增表和 orders.process_type；不迁移/删除旧表。

ALTER TABLE "orders" ADD COLUMN "process_type" TEXT NOT NULL DEFAULT 'CLASSIC';
ALTER TABLE "orders" ADD CONSTRAINT "orders_process_type_check"
  CHECK ("process_type" IN ('CLASSIC', 'GAME_DISPATCH'));

CREATE TABLE "game_dispatch_templates" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "copy_lines" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_dispatch_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_dispatch_template_fields" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "template_id" UUID NOT NULL,
  "field_key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "field_type" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "options" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "placeholder" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_dispatch_template_fields_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_dispatch_positions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "template_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "default_count" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_dispatch_positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_dispatch_rank_rules" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "template_id" UUID NOT NULL,
  "rank_label" TEXT NOT NULL,
  "add_price_fen" BIGINT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_dispatch_rank_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_dispatch_template_snapshots" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "template_id" UUID,
  "template_name" TEXT NOT NULL,
  "fields_json" JSONB NOT NULL,
  "positions_json" JSONB NOT NULL,
  "rank_rules_json" JSONB NOT NULL,
  "copy_lines_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_dispatch_template_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_dispatch_orders" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "snapshot_id" UUID,
  "dispatch_no" TEXT NOT NULL,
  "form_values_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "mode_label" TEXT,
  "target_rank_label" TEXT,
  "desired_start_at" TIMESTAMP(3) WITH TIME ZONE,
  "duration_minutes" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_dispatch_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_dispatch_lines" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "dispatch_order_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "position_label" TEXT NOT NULL,
  "required_count" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_dispatch_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_dispatch_rounds" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "dispatch_order_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "round_no" INTEGER NOT NULL,
  "opens_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "closes_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_dispatch_rounds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_dispatch_applications" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "round_id" UUID NOT NULL,
  "line_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "player_id" UUID NOT NULL,
  "position_label" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'APPLIED',
  "player_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_dispatch_applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_slots" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "dispatch_order_id" UUID NOT NULL,
  "line_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "player_id" UUID NOT NULL,
  "position_label" TEXT NOT NULL,
  "unit_price_fen" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SELECTED',
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "order_slots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_dispatch_templates_tenant_id_name_key"
  ON "game_dispatch_templates"("tenant_id", "name");
CREATE INDEX "game_dispatch_templates_tenant_id_enabled_idx"
  ON "game_dispatch_templates"("tenant_id", "enabled");

CREATE UNIQUE INDEX "gd_template_fields_tenant_template_key_key"
  ON "game_dispatch_template_fields"("tenant_id", "template_id", "field_key");
CREATE INDEX "gd_template_fields_tenant_template_sort_idx"
  ON "game_dispatch_template_fields"("tenant_id", "template_id", "sort_order");

CREATE UNIQUE INDEX "game_dispatch_positions_tenant_template_label_key"
  ON "game_dispatch_positions"("tenant_id", "template_id", "label");
CREATE INDEX "game_dispatch_positions_tenant_template_sort_idx"
  ON "game_dispatch_positions"("tenant_id", "template_id", "sort_order");

CREATE UNIQUE INDEX "game_dispatch_rank_rules_tenant_template_rank_key"
  ON "game_dispatch_rank_rules"("tenant_id", "template_id", "rank_label");
CREATE INDEX "game_dispatch_rank_rules_tenant_template_sort_idx"
  ON "game_dispatch_rank_rules"("tenant_id", "template_id", "sort_order");

CREATE UNIQUE INDEX "gd_snapshots_tenant_id_order_id_key"
  ON "game_dispatch_template_snapshots"("tenant_id", "order_id");
CREATE INDEX "gd_snapshots_tenant_id_template_id_idx"
  ON "game_dispatch_template_snapshots"("tenant_id", "template_id");

CREATE UNIQUE INDEX "game_dispatch_orders_tenant_id_order_id_key"
  ON "game_dispatch_orders"("tenant_id", "order_id");
CREATE UNIQUE INDEX "game_dispatch_orders_tenant_id_dispatch_no_key"
  ON "game_dispatch_orders"("tenant_id", "dispatch_no");

CREATE UNIQUE INDEX "game_dispatch_lines_tenant_dispatch_position_key"
  ON "game_dispatch_lines"("tenant_id", "dispatch_order_id", "position_label");
CREATE INDEX "game_dispatch_lines_tenant_order_sort_idx"
  ON "game_dispatch_lines"("tenant_id", "order_id", "sort_order");

CREATE UNIQUE INDEX "game_dispatch_rounds_tenant_dispatch_no_key"
  ON "game_dispatch_rounds"("tenant_id", "dispatch_order_id", "round_no");
CREATE INDEX "game_dispatch_rounds_tenant_order_status_close_idx"
  ON "game_dispatch_rounds"("tenant_id", "order_id", "status", "closes_at");

CREATE UNIQUE INDEX "gd_applications_tenant_round_line_player_key"
  ON "game_dispatch_applications"("tenant_id", "round_id", "line_id", "player_id");
CREATE INDEX "gd_applications_tenant_order_line_status_idx"
  ON "game_dispatch_applications"("tenant_id", "order_id", "line_id", "status");
CREATE INDEX "gd_applications_tenant_player_status_idx"
  ON "game_dispatch_applications"("tenant_id", "player_id", "status");
CREATE INDEX "gd_applications_tenant_round_status_idx"
  ON "game_dispatch_applications"("tenant_id", "round_id", "status");

CREATE UNIQUE INDEX "order_slots_tenant_application_id_key"
  ON "order_slots"("tenant_id", "application_id");
CREATE UNIQUE INDEX "order_slots_tenant_order_player_key"
  ON "order_slots"("tenant_id", "order_id", "player_id");
CREATE INDEX "order_slots_tenant_order_line_idx"
  ON "order_slots"("tenant_id", "order_id", "line_id");
CREATE INDEX "order_slots_tenant_player_status_idx"
  ON "order_slots"("tenant_id", "player_id", "status");

ALTER TABLE "game_dispatch_templates" ADD CONSTRAINT "gd_templates_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_template_fields" ADD CONSTRAINT "gd_template_fields_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_template_fields" ADD CONSTRAINT "gd_template_fields_template_fkey"
  FOREIGN KEY ("template_id") REFERENCES "game_dispatch_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_positions" ADD CONSTRAINT "gd_positions_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_positions" ADD CONSTRAINT "gd_positions_template_fkey"
  FOREIGN KEY ("template_id") REFERENCES "game_dispatch_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_rank_rules" ADD CONSTRAINT "gd_rank_rules_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_rank_rules" ADD CONSTRAINT "gd_rank_rules_template_fkey"
  FOREIGN KEY ("template_id") REFERENCES "game_dispatch_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_template_snapshots" ADD CONSTRAINT "gd_snapshots_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_template_snapshots" ADD CONSTRAINT "gd_snapshots_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_orders" ADD CONSTRAINT "gd_orders_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_orders" ADD CONSTRAINT "gd_orders_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_lines" ADD CONSTRAINT "gd_lines_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_lines" ADD CONSTRAINT "gd_lines_dispatch_order_fkey"
  FOREIGN KEY ("dispatch_order_id") REFERENCES "game_dispatch_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_lines" ADD CONSTRAINT "gd_lines_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_rounds" ADD CONSTRAINT "gd_rounds_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_rounds" ADD CONSTRAINT "gd_rounds_dispatch_order_fkey"
  FOREIGN KEY ("dispatch_order_id") REFERENCES "game_dispatch_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_rounds" ADD CONSTRAINT "gd_rounds_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_applications" ADD CONSTRAINT "gd_applications_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_applications" ADD CONSTRAINT "gd_applications_round_fkey"
  FOREIGN KEY ("round_id") REFERENCES "game_dispatch_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_applications" ADD CONSTRAINT "gd_applications_line_fkey"
  FOREIGN KEY ("line_id") REFERENCES "game_dispatch_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_applications" ADD CONSTRAINT "gd_applications_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_applications" ADD CONSTRAINT "gd_applications_player_fkey"
  FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_slots" ADD CONSTRAINT "order_slots_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_slots" ADD CONSTRAINT "order_slots_order_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_slots" ADD CONSTRAINT "order_slots_dispatch_order_fkey"
  FOREIGN KEY ("dispatch_order_id") REFERENCES "game_dispatch_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_slots" ADD CONSTRAINT "order_slots_line_fkey"
  FOREIGN KEY ("line_id") REFERENCES "game_dispatch_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_slots" ADD CONSTRAINT "order_slots_application_fkey"
  FOREIGN KEY ("application_id") REFERENCES "game_dispatch_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_slots" ADD CONSTRAINT "order_slots_player_fkey"
  FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "game_dispatch_positions" ADD CONSTRAINT "gd_positions_default_count_check"
  CHECK ("default_count" BETWEEN 1 AND 10);
ALTER TABLE "game_dispatch_rank_rules" ADD CONSTRAINT "gd_rank_rules_add_price_check"
  CHECK ("add_price_fen" >= 0);
ALTER TABLE "game_dispatch_orders" ADD CONSTRAINT "gd_orders_duration_check"
  CHECK ("duration_minutes" BETWEEN 1 AND 1440);
ALTER TABLE "game_dispatch_lines" ADD CONSTRAINT "gd_lines_required_count_check"
  CHECK ("required_count" BETWEEN 1 AND 10);
ALTER TABLE "game_dispatch_rounds" ADD CONSTRAINT "gd_rounds_status_check"
  CHECK ("status" IN ('OPEN', 'CLOSED'));
ALTER TABLE "game_dispatch_applications" ADD CONSTRAINT "gd_applications_status_check"
  CHECK ("status" IN ('APPLIED', 'WITHDRAWN', 'REJECTED', 'SELECTED', 'EXPIRED'));
ALTER TABLE "order_slots" ADD CONSTRAINT "order_slots_status_check"
  CHECK ("status" IN ('SELECTED', 'CANCELLED'));
ALTER TABLE "order_slots" ADD CONSTRAINT "order_slots_unit_price_check"
  CHECK ("unit_price_fen" >= 0);

ALTER TABLE "game_dispatch_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_templates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_template_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_template_fields" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_positions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_rank_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_rank_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_template_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_template_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_rounds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_rounds" FORCE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_applications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_slots" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "game_dispatch_templates" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_dispatch_template_fields" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_dispatch_positions" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_dispatch_rank_rules" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_dispatch_template_snapshots" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_dispatch_orders" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_dispatch_lines" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_dispatch_rounds" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "game_dispatch_applications" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "order_slots" FOR ALL TO pw USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation_runtime ON "game_dispatch_templates" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_dispatch_template_fields" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_dispatch_positions" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_dispatch_rank_rules" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_dispatch_template_snapshots" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_dispatch_orders" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_dispatch_lines" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_dispatch_rounds" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "game_dispatch_applications" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "order_slots" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
