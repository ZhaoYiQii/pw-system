-- 派单模板表单设计器（S1）：模板分区（模块）+ 字段列宽 + 快照分区固化
-- additive：只新增表与列，并把已有模板回填为「默认模块 + 单列」。

CREATE TABLE "game_dispatch_template_sections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "template_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "columns" INTEGER NOT NULL DEFAULT 1,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "game_dispatch_template_sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "game_dispatch_template_sections_columns_check" CHECK ("columns" BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX "gd_template_sections_tenant_template_name_key"
  ON "game_dispatch_template_sections"("tenant_id", "template_id", "name");
CREATE INDEX "gd_template_sections_tenant_template_sort_idx"
  ON "game_dispatch_template_sections"("tenant_id", "template_id", "sort_order");

ALTER TABLE "game_dispatch_template_sections"
  ADD CONSTRAINT "game_dispatch_template_sections_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_dispatch_template_sections"
  ADD CONSTRAINT "game_dispatch_template_sections_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "game_dispatch_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_dispatch_template_fields"
  ADD COLUMN "section_id" UUID,
  ADD COLUMN "col_span" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "row_break_before" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "game_dispatch_template_fields"
  ADD CONSTRAINT "game_dispatch_template_fields_col_span_check" CHECK ("col_span" BETWEEN 1 AND 4);

ALTER TABLE "game_dispatch_template_snapshots"
  ADD COLUMN "sections_json" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 系统区块的自定义标题（岗位席位 / 段位加价 / 复制文案 等），店主可改名
ALTER TABLE "game_dispatch_templates"
  ADD COLUMN "block_labels" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 回填：每个已有模板生成默认分区，并把其全部字段归入该分区（保留原命名与必填设置）
INSERT INTO "game_dispatch_template_sections"
  ("id", "tenant_id", "template_id", "name", "columns", "sort_order", "enabled", "created_at", "updated_at", "version")
SELECT gen_random_uuid(), t."tenant_id", t."id", '基本信息', 1, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1
FROM "game_dispatch_templates" t;

UPDATE "game_dispatch_template_fields" f
SET "section_id" = s."id"
FROM "game_dispatch_template_sections" s
WHERE s."tenant_id" = f."tenant_id"
  AND s."template_id" = f."template_id"
  AND f."section_id" IS NULL;

ALTER TABLE "game_dispatch_template_fields"
  ADD CONSTRAINT "game_dispatch_template_fields_section_id_fkey"
  FOREIGN KEY ("section_id") REFERENCES "game_dispatch_template_sections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "gd_template_fields_tenant_template_section_sort_idx"
  ON "game_dispatch_template_fields"("tenant_id", "template_id", "section_id", "sort_order");

ALTER TABLE "game_dispatch_template_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_template_sections" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "game_dispatch_template_sections" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "game_dispatch_template_sections" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
