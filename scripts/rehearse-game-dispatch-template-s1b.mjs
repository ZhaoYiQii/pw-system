import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabaseClient } from "@pw/database";

const databaseUrl = process.env.PW_S1B_REHEARSAL_DATABASE_URL;
if (!databaseUrl) throw new Error("PW_S1B_REHEARSAL_DATABASE_URL is required");
const target = new URL(databaseUrl);
const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !databaseName.startsWith("pw_saas_s1b_rehearsal_")
) {
  throw new Error(
    "rehearsal target must be localhost and start with pw_saas_s1b_rehearsal_",
  );
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePrisma = path.join(root, "packages", "database", "prisma");
const s1bNames = [
  "20260914100000_generic_dispatch_template_config",
  "20260915090000_s1b_config_pair_check_null_semantics",
];
const firstS1bName = s1bNames[0];
const ownerToken = randomUUID();
let temporaryRoot;

function assert(condition, message) {
  if (!condition) throw new Error(`S1b rehearsal assertion failed: ${message}`);
}

async function deploy(configPath) {
  const prismaCli = path.join(
    root,
    "packages",
    "database",
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--config", configPath],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`prisma migrate deploy failed (${code ?? signal})`)),
    );
  });
}

const fixtureSql = String.raw`
  INSERT INTO "tenants" ("id", "code", "name", "updated_at") VALUES
    ('00000000-0000-4000-8000-000000000001', 's1b_rehearsal', 'S1b 演练门店', CURRENT_TIMESTAMP);
  INSERT INTO "customer_profiles" ("id", "tenant_id", "name", "updated_at") VALUES
    ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', '虚构客户', CURRENT_TIMESTAMP);
  INSERT INTO "orders" ("id", "tenant_id", "order_no", "customer_profile_id", "updated_at") VALUES
    ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', 'S1B-HISTORY-001', '00000000-0000-4000-8000-000000000011', CURRENT_TIMESTAMP);
  INSERT INTO "game_dispatch_templates" ("id", "tenant_id", "name", "copy_lines", "block_labels", "updated_at") VALUES
    ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', '无岗位无加价', '[]', '{}', CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', '可自动绑定', '[]', '{"positions":"队伍配置"}', CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', '需要人工复核', '[]', '{}', CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', '历史兼容', '[]', '{}', CURRENT_TIMESTAMP);
  INSERT INTO "game_dispatch_template_sections" ("id", "tenant_id", "template_id", "name", "columns", "sort_order", "updated_at") VALUES
    ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', '下单信息', 2, 0, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', '下单信息', 1, 0, CURRENT_TIMESTAMP);
  INSERT INTO "game_dispatch_template_fields"
    ("id", "tenant_id", "template_id", "section_id", "field_key", "label", "field_type", "semantic_role", "required", "options", "sort_order", "updated_at") VALUES
    ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000201', 'rank', '目标段位', 'select', 'TARGET_RANK', true, '["青铜","白银"]', 0, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000201', 'note', '补充需求', 'multiline', 'ORDER_NOTE', false, '[]', 1, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000202', 'rank', '目标段位', 'select', 'TARGET_RANK', true, '["黄金"]', 0, CURRENT_TIMESTAMP);
  INSERT INTO "game_dispatch_positions" ("id", "tenant_id", "template_id", "label", "default_count", "sort_order", "updated_at") VALUES
    ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', '打野', 2, 0, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', '辅助', 1, 1, CURRENT_TIMESTAMP);
  INSERT INTO "game_dispatch_rank_rules" ("id", "tenant_id", "template_id", "rank_label", "add_price_fen", "sort_order", "updated_at") VALUES
    ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', '青铜', 1000, 0, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', '白银', 2000, 1, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', '铂金', 3000, 0, CURRENT_TIMESTAMP);
  INSERT INTO "game_dispatch_template_versions" ("id", "tenant_id", "template_id", "version_no", "config_json", "change_note") VALUES
    ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000104', 1, '{"schemaVersion":1,"sentinel":"unchanged"}', '历史版本');
  INSERT INTO "game_dispatch_template_snapshots"
    ("id", "tenant_id", "order_id", "template_id", "template_version_id", "template_name", "fields_json", "sections_json", "positions_json", "rank_rules_json", "copy_lines_json", "updated_at") VALUES
    ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000601', '历史兼容', '{"sentinel":"fields"}', '[{"sentinel":"sections"}]', '[{"sentinel":"positions"}]', '[{"sentinel":"rules"}]', '[{"sentinel":"copy"}]', CURRENT_TIMESTAMP);
`;

async function verify(client) {
  const templates = await client.$queryRaw`
    SELECT id::text AS id, legacy_conversion_state AS state, draft_schema_version AS version,
      draft_config_json AS config, legacy_conversion_issues AS issues
    FROM game_dispatch_templates WHERE tenant_id = '00000000-0000-4000-8000-000000000001' ORDER BY id
  `;
  assert(templates.length === 4, "all four legacy templates were converted");
  assert(
    templates.every(
      (row) => row.version === 2 && row.config.schemaVersion === 2,
    ),
    "all drafts are schema v2",
  );
  const fixed = templates.find((row) => row.id.endsWith("0101"));
  assert(fixed.state === "READY", "template without price rules is READY");
  assert(
    fixed.config.staffingSource.kind === "FIXED" &&
      fixed.config.staffingSource.count === 1,
    "missing positions use fixed staffing",
  );
  const ready = templates.find((row) => row.id.endsWith("0102"));
  const table = ready.config.components.find(
    (component) => component.kind === "REPEATABLE_TABLE",
  );
  const rank = ready.config.components.find(
    (component) => component.semanticRole === "TARGET_RANK",
  );
  const labelKey = table.columns.find(
    (column) => column.semanticRole === "STAFFING_LABEL",
  ).stableKey;
  const countKey = table.columns.find(
    (column) => column.semanticRole === "STAFFING_COUNT",
  ).stableKey;
  assert(
    ready.state === "READY" && ready.issues.length === 0,
    "exact rank mapping is READY",
  );
  assert(
    table.defaultRows
      .map((row) => `${row[labelKey]}:${row[countKey]}`)
      .join("|") === "打野:2|辅助:1",
    "staffing rows preserve order and counts",
  );
  assert(
    ready.config.staffingSource.componentKey === table.stableKey,
    "staffing source targets the table",
  );
  assert(
    rank.options.map((option) => option.priceDeltaFen).join(",") ===
      "1000,2000",
    "rank prices preserve integer fen and order",
  );
  const review = templates.find((row) => row.id.endsWith("0103"));
  assert(
    review.state === "NEEDS_REVIEW",
    "unmatched rank mapping needs review",
  );
  assert(
    review.issues.every(
      (issue) => Object.keys(issue).sort().join(",") === "code,stableKey",
    ),
    "issues contain code and stableKey only",
  );
  assert(
    review.config.legacyCompatibility.unboundPriceRules[0].label === "铂金",
    "unbound legacy rule is preserved",
  );
  assert(
    !JSON.stringify(review.config.components).includes("3000"),
    "unmatched price is not guessed",
  );
  const history = await client.$queryRaw`
    SELECT version.config_json = '{"schemaVersion":1,"sentinel":"unchanged"}'::jsonb AS version_unchanged,
      snapshot.fields_json = '{"sentinel":"fields"}'::jsonb AND snapshot.sections_json = '[{"sentinel":"sections"}]'::jsonb
        AND snapshot.positions_json = '[{"sentinel":"positions"}]'::jsonb AND snapshot.rank_rules_json = '[{"sentinel":"rules"}]'::jsonb
        AND snapshot.copy_lines_json = '[{"sentinel":"copy"}]'::jsonb AS snapshot_unchanged,
      snapshot.config_json IS NULL AND snapshot.schema_version IS NULL AS v2_snapshot_empty
    FROM game_dispatch_template_versions version JOIN game_dispatch_template_snapshots snapshot ON snapshot.template_version_id = version.id
    WHERE version.id = '00000000-0000-4000-8000-000000000601'
  `;
  assert(
    history[0]?.version_unchanged === true,
    "v1 version JSON is immutable",
  );
  assert(
    history[0]?.snapshot_unchanged === true &&
      history[0]?.v2_snapshot_empty === true,
    "historical snapshot stays unchanged",
  );
  const catalog = await client.$queryRaw`
    SELECT (SELECT count(*)::int FROM pg_constraint WHERE conname IN
      ('gd_templates_draft_config_pair_check', 'gd_templates_legacy_conversion_state_check', 'gd_templates_legacy_conversion_issues_check', 'gd_snapshots_config_pair_check') AND convalidated) AS validated_checks,
      (SELECT count(*)::int FROM pg_indexes WHERE tablename IN ('game_dispatch_templates', 'game_dispatch_template_snapshots') AND indexdef ILIKE '% USING gin %') AS gin_indexes,
      (SELECT count(*)::int FROM pg_class WHERE relname IN ('game_dispatch_templates', 'game_dispatch_template_snapshots') AND relrowsecurity AND relforcerowsecurity) AS protected_tables
  `;
  assert(catalog[0]?.validated_checks === 4, "all S1b checks are validated");
  assert(catalog[0]?.gin_indexes === 0, "S1b adds no JSON GIN index");
  assert(
    catalog[0]?.protected_tables === 2,
    "existing RLS remains enabled and forced",
  );
  console.log(
    "S1b rehearsal passed: templates=4, validatedChecks=4, protectedTables=2",
  );
}

async function removeOwnedTemporaryRoot() {
  if (!temporaryRoot) return;
  const expectedRoot = await realpath(os.tmpdir());
  const actualRoot = await realpath(temporaryRoot);
  const marker = await readFile(
    path.join(actualRoot, ".s1b-rehearsal-owner"),
    "utf8",
  );
  assert(
    path.dirname(actualRoot) === expectedRoot,
    "temporary directory is below system temp root",
  );
  assert(marker === ownerToken, "temporary directory ownership marker matches");
  await rm(actualRoot, { recursive: true });
}

try {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pw-s1b-rehearsal-"));
  await writeFile(path.join(temporaryRoot, ".s1b-rehearsal-owner"), ownerToken);
  const stagedPrisma = path.join(temporaryRoot, "prisma");
  const stagedMigrations = path.join(stagedPrisma, "migrations");
  await mkdir(stagedMigrations, { recursive: true });
  await cp(
    path.join(sourcePrisma, "schema.prisma"),
    path.join(stagedPrisma, "schema.prisma"),
  );
  const names = (
    await readdir(path.join(sourcePrisma, "migrations"), {
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isDirectory() && entry.name < firstS1bName)
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await cp(
      path.join(sourcePrisma, "migrations", name),
      path.join(stagedMigrations, name),
      { recursive: true },
    );
  }
  const configPath = path.join(temporaryRoot, "prisma.config.mjs");
  const config = {
    schema: path.join(stagedPrisma, "schema.prisma"),
    migrations: { path: stagedMigrations },
  };
  await writeFile(
    configPath,
    `export default { ...${JSON.stringify(config)}, datasource: { url: process.env.DATABASE_URL } };\n`,
  );
  await deploy(configPath);
  const client = createDatabaseClient(databaseUrl);
  try {
    await client.$transaction(async (tx) => {
      for (const statement of fixtureSql
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)) {
        await tx.$executeRawUnsafe(statement);
      }
    });
  } finally {
    await client.$disconnect();
  }
  for (const name of s1bNames) {
    await cp(
      path.join(sourcePrisma, "migrations", name),
      path.join(stagedMigrations, name),
      { recursive: true },
    );
  }
  await deploy(configPath);
  const verificationClient = createDatabaseClient(databaseUrl);
  try {
    await verify(verificationClient);
  } finally {
    await verificationClient.$disconnect();
  }
} finally {
  await removeOwnedTemporaryRoot();
}
