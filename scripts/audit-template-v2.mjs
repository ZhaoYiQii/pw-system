// S5 只读审计：通用派单模板 v2 的数据健康度计数。
//
// 用法：
//   DATABASE_URL=postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public \
//   node scripts/audit-template-v2.mjs
//
// 安全边界：
// - 只允许已授权的一次性测试库（库名守卫）；
// - 纯只读 SELECT；不输出 config、订单值、客户姓名/手机号等任何内容，只输出计数与 id 样例。
import { createDatabaseClient } from "@pw/database";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const databaseName = new URL(url).pathname.replace(/^\//, "");
if (databaseName !== "pw_saas_s2_task2_20260916") {
  throw new Error(`refusing to audit database: ${databaseName}`);
}

const client = createDatabaseClient(url);
const SAMPLE_LIMIT = 5;

/** 只输出 id 样例，绝不带出内容字段。 */
function ids(rows, pick = (row) => row.id) {
  return rows.slice(0, SAMPLE_LIMIT).map(pick);
}

try {
  const templates = await client.gameDispatchTemplate.findMany({
    select: {
      id: true,
      tenantId: true,
      gameId: true,
      activeVersionId: true,
      archivedAt: true,
      normalizedName: true,
      legacyConversionState: true,
      legacyConversionIssues: true,
    },
  });
  const versions = await client.gameDispatchTemplateVersion.findMany({
    select: { id: true, tenantId: true, templateId: true },
  });
  const versionsByTemplate = new Set(versions.map((v) => v.templateId));
  const templateIds = new Set(templates.map((t) => t.id));

  const unclassified = templates.filter((t) => t.gameId === null);
  const withoutActiveVersion = templates.filter(
    (t) => t.activeVersionId === null && t.archivedAt === null,
  );
  const nameGroups = new Map();
  for (const t of templates) {
    const key = `${t.tenantId}:${t.normalizedName}`;
    nameGroups.set(key, [...(nameGroups.get(key) ?? []), t]);
  }
  const duplicateNames = [...nameGroups.values()].filter(
    (group) => group.length > 1,
  );
  const orphanVersions = versions.filter((v) => !templateIds.has(v.templateId));
  const needsReview = templates.filter((t) => {
    const issues = Array.isArray(t.legacyConversionIssues)
      ? t.legacyConversionIssues
      : [];
    return t.legacyConversionState !== "NOT_REQUIRED" || issues.length > 0;
  });
  const danglingActiveVersion = templates.filter(
    (t) =>
      t.activeVersionId !== null && !versionsByTemplate.has(t.activeVersionId),
  );

  const report = {
    database: databaseName,
    generatedAt: new Date().toISOString(),
    totalTemplates: templates.length,
    totalVersions: versions.length,
    counts: {
      unclassified: unclassified.length,
      withoutActiveVersion: withoutActiveVersion.length,
      duplicateNames: duplicateNames.length,
      orphanVersions: orphanVersions.length,
      danglingActiveVersion: danglingActiveVersion.length,
      needsReview: needsReview.length,
    },
    samples: {
      unclassifiedIds: ids(unclassified),
      withoutActiveVersionIds: ids(withoutActiveVersion),
      duplicateNameGroups: duplicateNames
        .slice(0, SAMPLE_LIMIT)
        .map((group) => group.map((t) => t.id)),
      orphanVersionIds: ids(orphanVersions),
      danglingActiveVersionIds: ids(danglingActiveVersion),
      needsReviewIds: ids(needsReview),
    },
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.$disconnect();
}
