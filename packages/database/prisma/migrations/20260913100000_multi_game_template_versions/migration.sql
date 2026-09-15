-- 多游戏模板中心 v2（S1）：游戏归属、草稿修订、语义角色、发布版本与订单版本引用。
-- expand-compatible：不删除表、列或业务数据；旧模板生成不可变版本 1，旧订单保持原样。

CREATE TYPE "GameDispatchTemplateStatus" AS ENUM (
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED'
);

CREATE TYPE "GameDispatchTemplateSemanticRole" AS ENUM (
  'CUSTOM',
  'MODE',
  'TARGET_RANK',
  'CURRENT_RANK',
  'DURATION_MINUTES',
  'SERVER_REGION',
  'CONTACT',
  'ORDER_NOTE'
);

ALTER TABLE "game_dispatch_templates"
  ADD COLUMN "game_id" UUID,
  ADD COLUMN "normalized_name" TEXT GENERATED ALWAYS AS (
    lower(regexp_replace(btrim("name"), '\s+', ' ', 'g'))
  ) STORED,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "status" "GameDispatchTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "active_version_id" UUID,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_used_at" TIMESTAMP(3),
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID,
  ADD COLUMN "archived_at" TIMESTAMP(3);

ALTER TABLE "game_dispatch_template_fields"
  ADD COLUMN "semantic_role" "GameDispatchTemplateSemanticRole" NOT NULL DEFAULT 'CUSTOM';

CREATE TABLE "game_dispatch_template_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "template_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "config_json" JSONB NOT NULL,
  "change_note" TEXT,
  "published_by" UUID,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source_version_id" UUID,
  CONSTRAINT "game_dispatch_template_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gd_template_versions_version_no_check" CHECK ("version_no" > 0)
);

ALTER TABLE "game_dispatch_template_snapshots"
  ADD COLUMN "game_id" UUID,
  ADD COLUMN "template_version_id" UUID;

ALTER TABLE "game_dispatch_orders"
  ADD COLUMN "game_id" UUID,
  ADD COLUMN "template_version_id" UUID;

DROP INDEX "game_dispatch_templates_tenant_id_name_key";

CREATE UNIQUE INDEX "gd_templates_classified_name_key"
  ON "game_dispatch_templates"("tenant_id", "game_id", "normalized_name")
  WHERE "game_id" IS NOT NULL AND "archived_at" IS NULL;

CREATE UNIQUE INDEX "gd_templates_unclassified_name_key"
  ON "game_dispatch_templates"("tenant_id", "name")
  WHERE "game_id" IS NULL AND "archived_at" IS NULL;

CREATE UNIQUE INDEX "gd_templates_tenant_id_id_key"
  ON "game_dispatch_templates"("tenant_id", "id");

CREATE INDEX "gd_templates_tenant_game_status_updated_idx"
  ON "game_dispatch_templates"("tenant_id", "game_id", "status", "updated_at");

CREATE INDEX "gd_templates_tenant_active_version_idx"
  ON "game_dispatch_templates"("tenant_id", "active_version_id");

CREATE UNIQUE INDEX "gd_templates_one_default_per_game_key"
  ON "game_dispatch_templates"("tenant_id", "game_id")
  WHERE "game_id" IS NOT NULL
    AND "is_default" = true
    AND "archived_at" IS NULL;

CREATE UNIQUE INDEX "gd_template_versions_tenant_template_no_key"
  ON "game_dispatch_template_versions"("tenant_id", "template_id", "version_no");

CREATE UNIQUE INDEX "gd_template_versions_tenant_id_id_key"
  ON "game_dispatch_template_versions"("tenant_id", "id");

CREATE UNIQUE INDEX "gd_template_versions_tenant_template_id_key"
  ON "game_dispatch_template_versions"("tenant_id", "template_id", "id");

CREATE INDEX "gd_template_versions_tenant_template_published_idx"
  ON "game_dispatch_template_versions"("tenant_id", "template_id", "published_at");

CREATE INDEX "gd_template_versions_tenant_source_idx"
  ON "game_dispatch_template_versions"("tenant_id", "source_version_id");

CREATE UNIQUE INDEX "gd_template_fields_semantic_role_key"
  ON "game_dispatch_template_fields"("tenant_id", "template_id", "semantic_role")
  WHERE "semantic_role" <> 'CUSTOM';

CREATE INDEX "gd_snapshots_tenant_template_version_idx"
  ON "game_dispatch_template_snapshots"("tenant_id", "template_version_id");

CREATE INDEX "gd_orders_tenant_game_created_idx"
  ON "game_dispatch_orders"("tenant_id", "game_id", "created_at");

CREATE INDEX "gd_orders_tenant_template_version_idx"
  ON "game_dispatch_orders"("tenant_id", "template_version_id");

CREATE UNIQUE INDEX "games_tenant_id_id_key"
  ON "games"("tenant_id", "id");

ALTER TABLE "game_dispatch_templates"
  ADD CONSTRAINT "gd_templates_tenant_game_fkey"
  FOREIGN KEY ("tenant_id", "game_id")
  REFERENCES "games"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "game_dispatch_template_versions"
  ADD CONSTRAINT "gd_template_versions_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "game_dispatch_template_versions"
  ADD CONSTRAINT "gd_template_versions_tenant_template_fkey"
  FOREIGN KEY ("tenant_id", "template_id")
  REFERENCES "game_dispatch_templates"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_dispatch_template_versions"
  ADD CONSTRAINT "gd_template_versions_source_fkey"
  FOREIGN KEY ("tenant_id", "source_version_id")
  REFERENCES "game_dispatch_template_versions"("tenant_id", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "game_dispatch_template_snapshots"
  ADD CONSTRAINT "gd_snapshots_tenant_game_fkey"
  FOREIGN KEY ("tenant_id", "game_id")
  REFERENCES "games"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "game_dispatch_template_snapshots"
  ADD CONSTRAINT "gd_snapshots_tenant_template_version_fkey"
  FOREIGN KEY ("tenant_id", "template_version_id")
  REFERENCES "game_dispatch_template_versions"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "game_dispatch_orders"
  ADD CONSTRAINT "gd_orders_tenant_game_fkey"
  FOREIGN KEY ("tenant_id", "game_id")
  REFERENCES "games"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "game_dispatch_orders"
  ADD CONSTRAINT "gd_orders_tenant_template_version_fkey"
  FOREIGN KEY ("tenant_id", "template_version_id")
  REFERENCES "game_dispatch_template_versions"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "game_dispatch_template_versions" (
  "tenant_id",
  "template_id",
  "version_no",
  "config_json",
  "change_note",
  "published_at"
)
SELECT
  template."tenant_id",
  template."id",
  1,
  jsonb_build_object(
    'schemaVersion', 1,
    'templateId', template."id"::text,
    'gameId', NULL,
    'templateName', template."name",
    'description', NULL,
    'sections', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', section."id"::text,
            'name', section."name",
            'columns', section."columns",
            'sortOrder', section."sort_order",
            'enabled', section."enabled"
          )
          ORDER BY section."sort_order", section."id"
        )
        FROM "game_dispatch_template_sections" section
        WHERE section."tenant_id" = template."tenant_id"
          AND section."template_id" = template."id"
      ),
      '[]'::jsonb
    ),
    'fields', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'fieldKey', field."field_key",
            'label', field."label",
            'fieldType', field."field_type",
            'semanticRole', field."semantic_role",
            'required', field."required",
            'options', field."options",
            'placeholder', field."placeholder",
            'sectionId', field."section_id"::text,
            'colSpan', field."col_span",
            'rowBreakBefore', field."row_break_before",
            'sortOrder', field."sort_order",
            'enabled', field."enabled"
          )
          ORDER BY field."sort_order", field."id"
        )
        FROM "game_dispatch_template_fields" field
        WHERE field."tenant_id" = template."tenant_id"
          AND field."template_id" = template."id"
      ),
      '[]'::jsonb
    ),
    'positions', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'label', position."label",
            'defaultCount', position."default_count",
            'enabled', position."enabled",
            'sortOrder', position."sort_order"
          )
          ORDER BY position."sort_order", position."id"
        )
        FROM "game_dispatch_positions" position
        WHERE position."tenant_id" = template."tenant_id"
          AND position."template_id" = template."id"
      ),
      '[]'::jsonb
    ),
    'rankRules', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'rankLabel', rule."rank_label",
            'addPriceFen', rule."add_price_fen"::text,
            'sortOrder', rule."sort_order"
          )
          ORDER BY rule."sort_order", rule."id"
        )
        FROM "game_dispatch_rank_rules" rule
        WHERE rule."tenant_id" = template."tenant_id"
          AND rule."template_id" = template."id"
      ),
      '[]'::jsonb
    ),
    'copyLines', template."copy_lines",
    'blockLabels', template."block_labels"
  ),
  '旧模板迁移生成',
  template."updated_at"
FROM "game_dispatch_templates" template;

UPDATE "game_dispatch_templates" template
SET
  "active_version_id" = version."id",
  "status" = CASE
    WHEN template."enabled" THEN 'PUBLISHED'::"GameDispatchTemplateStatus"
    ELSE 'ARCHIVED'::"GameDispatchTemplateStatus"
  END,
  "archived_at" = CASE
    WHEN template."enabled" THEN NULL
    ELSE template."updated_at"
  END
FROM "game_dispatch_template_versions" version
WHERE version."tenant_id" = template."tenant_id"
  AND version."template_id" = template."id"
  AND version."version_no" = 1;

ALTER TABLE "game_dispatch_templates"
  ADD CONSTRAINT "gd_templates_active_version_fkey"
  FOREIGN KEY ("tenant_id", "id", "active_version_id")
  REFERENCES "game_dispatch_template_versions"("tenant_id", "template_id", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "game_dispatch_template_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "game_dispatch_template_versions" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform
  ON "game_dispatch_template_versions"
  FOR ALL TO pw
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation_runtime
  ON "game_dispatch_template_versions"
  FOR ALL TO pw_runtime
  USING ("tenant_id"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));
