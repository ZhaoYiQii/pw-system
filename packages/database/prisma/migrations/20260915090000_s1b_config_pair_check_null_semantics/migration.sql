-- S1b forward repair: PostgreSQL CHECK constraints accept NULL results.
-- Require the version column explicitly before evaluating the version value.

ALTER TABLE "game_dispatch_templates"
  DROP CONSTRAINT "gd_templates_draft_config_pair_check",
  ADD CONSTRAINT "gd_templates_draft_config_pair_check" CHECK (
    ("draft_config_json" IS NULL AND "draft_schema_version" IS NULL)
    OR ("draft_config_json" IS NOT NULL
      AND "draft_schema_version" IS NOT NULL
      AND "draft_schema_version" = 2
      AND jsonb_typeof("draft_config_json") = 'object'
      AND ("draft_config_json" -> 'schemaVersion' = '2'::jsonb) IS TRUE)
  ) NOT VALID;

ALTER TABLE "game_dispatch_template_snapshots"
  DROP CONSTRAINT "gd_snapshots_config_pair_check",
  ADD CONSTRAINT "gd_snapshots_config_pair_check" CHECK (
    ("config_json" IS NULL AND "schema_version" IS NULL)
    OR ("config_json" IS NOT NULL
      AND "schema_version" IS NOT NULL
      AND "schema_version" = 2
      AND jsonb_typeof("config_json") = 'object'
      AND ("config_json" -> 'schemaVersion' = '2'::jsonb) IS TRUE)
  ) NOT VALID;

ALTER TABLE "game_dispatch_templates"
  VALIDATE CONSTRAINT "gd_templates_draft_config_pair_check";

ALTER TABLE "game_dispatch_template_snapshots"
  VALIDATE CONSTRAINT "gd_snapshots_config_pair_check";
