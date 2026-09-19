-- 通用派单模板配置（S1b）：expand-only 持久化与旧模板草稿转换。
-- 保留 v1 发布版本、历史快照旧列和旧运行路径；本迁移不删除任何旧结构。

ALTER TYPE "GameDispatchTemplateSemanticRole" ADD VALUE IF NOT EXISTS 'STAFFING_LABEL';
ALTER TYPE "GameDispatchTemplateSemanticRole" ADD VALUE IF NOT EXISTS 'STAFFING_COUNT';

ALTER TABLE "game_dispatch_templates"
  ADD COLUMN "draft_config_json" JSONB,
  ADD COLUMN "draft_schema_version" INTEGER,
  ADD COLUMN "legacy_conversion_state" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "legacy_conversion_issues" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "game_dispatch_template_snapshots"
  ADD COLUMN "config_json" JSONB,
  ADD COLUMN "schema_version" INTEGER;

ALTER TABLE "game_dispatch_templates"
  ADD CONSTRAINT "gd_templates_draft_config_pair_check" CHECK (
    ("draft_config_json" IS NULL AND "draft_schema_version" IS NULL)
    OR ("draft_config_json" IS NOT NULL AND "draft_schema_version" = 2
      AND jsonb_typeof("draft_config_json") = 'object'
      AND ("draft_config_json" -> 'schemaVersion' = '2'::jsonb) IS TRUE)
  ) NOT VALID,
  ADD CONSTRAINT "gd_templates_legacy_conversion_state_check" CHECK (
    "legacy_conversion_state" IN ('NOT_REQUIRED', 'READY', 'NEEDS_REVIEW')
  ) NOT VALID,
  ADD CONSTRAINT "gd_templates_legacy_conversion_issues_check" CHECK (
    jsonb_typeof("legacy_conversion_issues") = 'array'
  ) NOT VALID;

ALTER TABLE "game_dispatch_template_snapshots"
  ADD CONSTRAINT "gd_snapshots_config_pair_check" CHECK (
    ("config_json" IS NULL AND "schema_version" IS NULL)
    OR ("config_json" IS NOT NULL AND "schema_version" = 2
      AND jsonb_typeof("config_json") = 'object'
      AND ("config_json" -> 'schemaVersion' = '2'::jsonb) IS TRUE)
  ) NOT VALID;

WITH conversion AS (
  SELECT
    template."id",
    template."tenant_id",
    replace(template."id"::text, '-', '') AS template_hex,
    COALESCE(rank_stats.rule_count, 0) AS rule_count,
    COALESCE(target_stats.target_count, 0) AS target_count,
    target_stats.target_field_id,
    (COALESCE(rank_stats.rule_count, 0) = 0 OR (
      COALESCE(target_stats.target_count, 0) = 1
      AND NOT EXISTS (
        SELECT 1
        FROM "game_dispatch_rank_rules" rule
        WHERE rule."tenant_id" = template."tenant_id"
          AND rule."template_id" = template."id"
          AND (SELECT count(*)
            FROM jsonb_array_elements(CASE
              WHEN jsonb_typeof(target_stats.target_options) = 'array'
                THEN target_stats.target_options
              ELSE '[]'::jsonb
            END) option_value
            WHERE option_value #>> '{}' = rule."rank_label") <> 1
      )
    )) AS can_bind_rank_rules
  FROM "game_dispatch_templates" template
  LEFT JOIN LATERAL (
    SELECT count(*) AS rule_count
    FROM "game_dispatch_rank_rules" rule
    WHERE rule."tenant_id" = template."tenant_id"
      AND rule."template_id" = template."id"
  ) rank_stats ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS target_count,
      min(field."id"::text)::uuid AS target_field_id,
      CASE WHEN count(*) = 1 THEN min(field."options"::text)::jsonb END AS target_options
    FROM "game_dispatch_template_fields" field
    WHERE field."tenant_id" = template."tenant_id"
      AND field."template_id" = template."id"
      AND field."enabled" = true
      AND field."semantic_role" = 'TARGET_RANK'
      AND field."field_type" = 'select'
  ) target_stats ON true
), converted AS (
  SELECT
    conversion.*,
    'legacy_unsectioned_' || template_hex AS fallback_section_key,
    'legacy_staffing_section_' || template_hex AS staffing_section_key,
    'legacy_staffing_' || template_hex AS staffing_component_key,
    'legacy_staffing_label_' || template_hex AS staffing_label_key,
    'legacy_staffing_count_' || template_hex AS staffing_count_key
  FROM conversion
)
UPDATE "game_dispatch_templates" template
SET
  "draft_config_json" = jsonb_build_object(
    'schemaVersion', 2,
    'sections', COALESCE((
      SELECT jsonb_agg(item.payload ORDER BY item.sort_order, item.tie_breaker)
      FROM (
        SELECT
          GREATEST(section."sort_order", 0) AS sort_order,
          section."id"::text AS tie_breaker,
          jsonb_build_object(
            'stableKey', 'section_' || replace(section."id"::text, '-', ''),
            'label', section."name",
            'enabled', section."enabled",
            'sortOrder', GREATEST(section."sort_order", 0),
            'layout', jsonb_build_object(
              'columns', GREATEST(1, LEAST(4, section."columns")))
              || CASE WHEN template."block_labels" #>> ARRAY['sections', section."name", 'density']
                IN ('comfortable', 'compact')
                THEN jsonb_build_object('density', template."block_labels" #>> ARRAY['sections', section."name", 'density'])
                ELSE '{}'::jsonb END
              || CASE WHEN template."block_labels" #>> ARRAY['sections', section."name", 'align']
                IN ('left', 'center')
                THEN jsonb_build_object('align', template."block_labels" #>> ARRAY['sections', section."name", 'align'])
                ELSE '{}'::jsonb END
          ) AS payload
        FROM "game_dispatch_template_sections" section
        WHERE section."tenant_id" = template."tenant_id"
          AND section."template_id" = template."id"

        UNION ALL

        SELECT
          COALESCE((SELECT max(GREATEST(section."sort_order", 0)) + 1
            FROM "game_dispatch_template_sections" section
            WHERE section."tenant_id" = template."tenant_id"
              AND section."template_id" = template."id"), 0),
          converted.fallback_section_key,
          jsonb_build_object(
            'stableKey', converted.fallback_section_key,
            'label', '基本信息', 'enabled', true,
            'sortOrder', COALESCE((SELECT max(GREATEST(section."sort_order", 0)) + 1
              FROM "game_dispatch_template_sections" section
              WHERE section."tenant_id" = template."tenant_id"
                AND section."template_id" = template."id"), 0),
            'layout', jsonb_build_object('columns', 1))
        WHERE EXISTS (SELECT 1 FROM "game_dispatch_template_fields" field
          WHERE field."tenant_id" = template."tenant_id"
            AND field."template_id" = template."id" AND field."section_id" IS NULL)

        UNION ALL

        SELECT
          COALESCE((SELECT max(GREATEST(section."sort_order", 0)) + 1
            FROM "game_dispatch_template_sections" section
            WHERE section."tenant_id" = template."tenant_id"
              AND section."template_id" = template."id"), 0)
            + CASE WHEN EXISTS (SELECT 1 FROM "game_dispatch_template_fields" field
              WHERE field."tenant_id" = template."tenant_id"
                AND field."template_id" = template."id" AND field."section_id" IS NULL)
              THEN 1 ELSE 0 END,
          converted.staffing_section_key,
          jsonb_build_object(
            'stableKey', converted.staffing_section_key,
            'label', COALESCE(NULLIF(template."block_labels" ->> 'positions', ''), '岗位与人数'),
            'enabled', true,
            'sortOrder', COALESCE((SELECT max(GREATEST(section."sort_order", 0)) + 1
              FROM "game_dispatch_template_sections" section
              WHERE section."tenant_id" = template."tenant_id"
                AND section."template_id" = template."id"), 0)
              + CASE WHEN EXISTS (SELECT 1 FROM "game_dispatch_template_fields" field
                WHERE field."tenant_id" = template."tenant_id"
                  AND field."template_id" = template."id" AND field."section_id" IS NULL)
                THEN 1 ELSE 0 END,
            'layout', jsonb_build_object('columns', 1))
        WHERE EXISTS (SELECT 1 FROM "game_dispatch_positions" position
          WHERE position."tenant_id" = template."tenant_id"
            AND position."template_id" = template."id" AND position."enabled" = true)
      ) item
    ), '[]'::jsonb),
    'components', COALESCE((
      SELECT jsonb_agg(item.payload ORDER BY item.sort_order, item.tie_breaker)
      FROM (
        SELECT
          GREATEST(field."sort_order", 0) AS sort_order,
          field."id"::text AS tie_breaker,
          CASE WHEN field."field_type" = 'note' THEN jsonb_build_object(
            'kind', 'NOTE',
            'stableKey', 'field_' || replace(field."id"::text, '-', ''),
            'sectionKey', CASE WHEN field."section_id" IS NULL
              THEN converted.fallback_section_key
              ELSE 'section_' || replace(field."section_id"::text, '-', '') END,
            'label', field."label", 'enabled', field."enabled",
            'sortOrder', GREATEST(field."sort_order", 0),
            'layout', jsonb_build_object(
              'colSpan', GREATEST(1, LEAST(4, field."col_span")),
              'rowBreakBefore', field."row_break_before"),
            'text', COALESCE(field."placeholder", '')
          ) ELSE jsonb_build_object(
            'kind', 'FIELD',
            'stableKey', 'field_' || replace(field."id"::text, '-', ''),
            'sectionKey', CASE WHEN field."section_id" IS NULL
              THEN converted.fallback_section_key
              ELSE 'section_' || replace(field."section_id"::text, '-', '') END,
            'label', field."label", 'enabled', field."enabled",
            'sortOrder', GREATEST(field."sort_order", 0),
            'layout', jsonb_build_object(
              'colSpan', GREATEST(1, LEAST(4, field."col_span")),
              'rowBreakBefore', field."row_break_before"),
            'fieldType', CASE field."field_type"
              WHEN 'select' THEN 'SINGLE_SELECT' WHEN 'multiline' THEN 'TEXTAREA'
              WHEN 'datetime' THEN 'DATETIME' WHEN 'duration' THEN 'NUMBER'
              ELSE 'TEXT' END,
            'semanticRole', field."semantic_role"::text,
            'required', field."required"
          ) || CASE WHEN field."placeholder" IS NOT NULL
            THEN jsonb_build_object('placeholder', field."placeholder") ELSE '{}'::jsonb END
            || CASE WHEN field."field_type" = 'select' THEN jsonb_build_object(
              'options', COALESCE((SELECT jsonb_agg(
                jsonb_build_object(
                  'value', 'option_' || replace(field."id"::text, '-', '') || '_' || option_row.ordinality,
                  'label', option_row.option_value #>> '{}')
                  || CASE WHEN converted.can_bind_rank_rules
                    AND field."id" = converted.target_field_id
                    AND matched_rule."add_price_fen" IS NOT NULL
                    THEN jsonb_build_object('priceDeltaFen', matched_rule."add_price_fen"::text)
                    ELSE '{}'::jsonb END
                ORDER BY option_row.ordinality)
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(field."options") = 'array'
                  THEN field."options" ELSE '[]'::jsonb END)
                  WITH ORDINALITY option_row(option_value, ordinality)
                LEFT JOIN "game_dispatch_rank_rules" matched_rule
                  ON matched_rule."tenant_id" = field."tenant_id"
                  AND matched_rule."template_id" = field."template_id"
                  AND matched_rule."rank_label" = option_row.option_value #>> '{}'), '[]'::jsonb))
              ELSE '{}'::jsonb END END AS payload
        FROM "game_dispatch_template_fields" field
        WHERE field."tenant_id" = template."tenant_id"
          AND field."template_id" = template."id"

        UNION ALL

        SELECT
          COALESCE((SELECT max(GREATEST(field."sort_order", 0)) + 1
            FROM "game_dispatch_template_fields" field
            WHERE field."tenant_id" = template."tenant_id"
              AND field."template_id" = template."id"), 0),
          converted.staffing_component_key,
          jsonb_build_object(
            'kind', 'REPEATABLE_TABLE', 'stableKey', converted.staffing_component_key,
            'sectionKey', converted.staffing_section_key,
            'label', COALESCE(NULLIF(template."block_labels" ->> 'positions', ''), '岗位与人数'),
            'enabled', true,
            'sortOrder', COALESCE((SELECT max(GREATEST(field."sort_order", 0)) + 1
              FROM "game_dispatch_template_fields" field
              WHERE field."tenant_id" = template."tenant_id"
                AND field."template_id" = template."id"), 0),
            'layout', jsonb_build_object('colSpan', 1, 'rowBreakBefore', true),
            'columns', jsonb_build_array(
              jsonb_build_object('stableKey', converted.staffing_label_key, 'label', '岗位',
                'columnType', 'TEXT', 'semanticRole', 'STAFFING_LABEL', 'required', true),
              jsonb_build_object('stableKey', converted.staffing_count_key, 'label', '人数',
                'columnType', 'NUMBER', 'semanticRole', 'STAFFING_COUNT', 'required', true)),
            'defaultRows', (SELECT jsonb_agg(jsonb_build_object(
              converted.staffing_label_key, position."label",
              converted.staffing_count_key, position."default_count")
              ORDER BY position."sort_order", position."id")
              FROM "game_dispatch_positions" position
              WHERE position."tenant_id" = template."tenant_id"
                AND position."template_id" = template."id" AND position."enabled" = true))
        WHERE EXISTS (SELECT 1 FROM "game_dispatch_positions" position
          WHERE position."tenant_id" = template."tenant_id"
            AND position."template_id" = template."id" AND position."enabled" = true)
      ) item
    ), '[]'::jsonb),
    'staffingSource', CASE WHEN EXISTS (SELECT 1 FROM "game_dispatch_positions" position
      WHERE position."tenant_id" = template."tenant_id"
        AND position."template_id" = template."id" AND position."enabled" = true)
      THEN jsonb_build_object('kind', 'REPEATABLE_TABLE_SUM',
        'componentKey', converted.staffing_component_key, 'columnKey', converted.staffing_count_key)
      ELSE jsonb_build_object('kind', 'FIXED', 'count', 1) END
  ) || CASE WHEN converted.can_bind_rank_rules THEN '{}'::jsonb ELSE jsonb_build_object(
    'legacyCompatibility', jsonb_build_object('unboundPriceRules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'label', rule."rank_label", 'priceDeltaFen', rule."add_price_fen"::text,
        'sortOrder', GREATEST(rule."sort_order", 0)) ORDER BY rule."sort_order", rule."id")
      FROM "game_dispatch_rank_rules" rule
      WHERE rule."tenant_id" = template."tenant_id"
        AND rule."template_id" = template."id"), '[]'::jsonb))) END,
  "draft_schema_version" = 2,
  "legacy_conversion_state" = CASE WHEN converted.can_bind_rank_rules THEN 'READY' ELSE 'NEEDS_REVIEW' END,
  "legacy_conversion_issues" = CASE
    WHEN converted.can_bind_rank_rules THEN '[]'::jsonb
    WHEN converted.target_count <> 1 THEN jsonb_build_array(jsonb_build_object(
      'code', 'TARGET_RANK_BINDING_UNAVAILABLE',
      'stableKey', 'legacy_rank_rules_' || converted.template_hex))
    ELSE jsonb_build_array(jsonb_build_object(
      'code', 'TARGET_RANK_OPTION_UNMATCHED',
      'stableKey', 'field_' || replace(converted.target_field_id::text, '-', ''))) END
FROM converted
WHERE converted."id" = template."id" AND converted."tenant_id" = template."tenant_id";

ALTER TABLE "game_dispatch_templates" VALIDATE CONSTRAINT "gd_templates_draft_config_pair_check";
ALTER TABLE "game_dispatch_templates" VALIDATE CONSTRAINT "gd_templates_legacy_conversion_state_check";
ALTER TABLE "game_dispatch_templates" VALIDATE CONSTRAINT "gd_templates_legacy_conversion_issues_check";
ALTER TABLE "game_dispatch_template_snapshots" VALIDATE CONSTRAINT "gd_snapshots_config_pair_check";
