// 算价模型：把"模板级"加价来源归并成"按游戏"的定价规则库。
//
// 用法（只读干跑，安全默认）：
//   DATABASE_URL=postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public \
//   node scripts/migrate-pricing-rules.mjs
//
//   node scripts/migrate-pricing-rules.mjs --apply   # 尚未实现，需 Task 1 获批后再启用
//
// 安全边界：
// - 只允许已授权的一次性测试库（库名守卫），与 scripts/audit-template-v2.mjs 一致；
// - 干跑模式纯只读，不写库；输出仅含模板/字段标识与金额，不含客户资料与订单值。
import { createDatabaseClient } from "@pw/database";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const databaseName = new URL(url).pathname.replace(/^\//, "");
if (databaseName !== "pw_saas_s2_task2_20260916") {
  throw new Error(`refusing to run against database: ${databaseName}`);
}
if (process.argv.includes("--apply")) {
  throw new Error(
    "--apply 尚未实现：写入规则库属于 Task 1 的实施动作，需先获批并实现写入路径。",
  );
}

const client = createDatabaseClient(url);

/** v1：模板级段位加价（game_dispatch_rank_rules）。 */
function collectV1Rules(rulesByTemplate, templatesById) {
  const byGameRank = new Map();
  let skippedNoGame = 0;
  for (const [templateId, rules] of rulesByTemplate) {
    const template = templatesById.get(templateId);
    if (!template) continue;
    if (!template.gameId) {
      skippedNoGame += rules.length;
      continue;
    }
    for (const rule of rules) {
      const key = `${template.tenantId}::${template.gameId}::${rule.rankLabel}`;
      const list = byGameRank.get(key) ?? [];
      list.push({
        source: "v1_rank_rule",
        addPriceFen: rule.addPriceFen.toString(),
        templateId,
        templateName: template.name,
        updatedAt: template.updatedAt.toISOString(),
      });
      byGameRank.set(key, list);
    }
  }
  return { byGameRank, skippedNoGame };
}

/** v2：模板配置里选项的 priceDeltaFen（按段位类字段可映射，其它字段只报告）。 */
function collectV2OptionPrices(config, template) {
  const items = [];
  const components = Array.isArray(config?.components) ? config.components : [];
  for (const component of components) {
    if (component?.kind !== "FIELD") continue;
    if (
      component?.fieldType !== "SINGLE_SELECT" &&
      component?.fieldType !== "MULTI_SELECT"
    ) {
      continue;
    }
    const stableKey = String(component.stableKey ?? "");
    const label = String(component.label ?? "");
    const rankLike =
      stableKey.toLowerCase().includes("rank") || label.includes("段位");
    for (const option of Array.isArray(component.options)
      ? component.options
      : []) {
      const price = option?.priceDeltaFen;
      if (typeof price !== "string" || price === "0") continue;
      items.push({
        source: "v2_option_price",
        rankLike,
        stableKey,
        label,
        optionValue: String(option?.value ?? ""),
        optionLabel: String(option?.label ?? ""),
        priceDeltaFen: price,
        templateId: template.id,
        templateName: template.name,
      });
    }
  }
  return items;
}

try {
  const [templates, versions, rankRules] = await Promise.all([
    client.gameDispatchTemplate.findMany({
      select: {
        id: true,
        tenantId: true,
        gameId: true,
        name: true,
        status: true,
        activeVersionId: true,
        draftConfigJson: true,
        archivedAt: true,
        updatedAt: true,
      },
    }),
    client.gameDispatchTemplateVersion.findMany({
      select: { id: true, configJson: true, versionNo: true },
    }),
    client.gameDispatchRankRule.findMany({
      select: {
        tenantId: true,
        templateId: true,
        rankLabel: true,
        addPriceFen: true,
      },
    }),
  ]);

  const templatesById = new Map(templates.map((t) => [t.id, t]));
  const versionsById = new Map(versions.map((v) => [v.id, v]));

  const rulesByTemplate = new Map();
  for (const rule of rankRules) {
    const list = rulesByTemplate.get(rule.templateId) ?? [];
    list.push(rule);
    rulesByTemplate.set(rule.templateId, list);
  }

  const { byGameRank, skippedNoGame } = collectV1Rules(
    rulesByTemplate,
    templatesById,
  );

  const v2Items = [];
  for (const template of templates) {
    if (template.archivedAt) continue;
    const published = template.activeVersionId
      ? versionsById.get(template.activeVersionId)?.configJson
      : null;
    if (published) v2Items.push(...collectV2OptionPrices(published, template));
    if (template.draftConfigJson) {
      v2Items.push(
        ...collectV2OptionPrices(template.draftConfigJson, template),
      );
    }
  }

  const conflicts = [];
  for (const [key, list] of byGameRank) {
    const distinct = new Set(list.map((item) => item.addPriceFen));
    if (distinct.size > 1) {
      conflicts.push({
        kind: "v1_same_game_rank_differs",
        key,
        values: [...distinct],
        templates: list.map(
          (item) => `${item.templateName}(${item.addPriceFen})`,
        ),
      });
    }
  }

  const rankLikeV2 = v2Items.filter((item) => item.rankLike);
  const nonRankV2 = v2Items.filter((item) => !item.rankLike);
  const v2FromUnclassified = v2Items.filter(
    (item) => !templatesById.get(item.templateId)?.gameId,
  ).length;
  for (const item of rankLikeV2) {
    const template = templatesById.get(item.templateId);
    if (!template?.gameId) continue;
    const key = `${template.tenantId}::${template.gameId}::${item.optionValue}`;
    const existing = byGameRank.get(key);
    if (!existing) continue;
    const values = new Set(existing.map((entry) => entry.addPriceFen));
    if (!values.has(item.priceDeltaFen)) {
      conflicts.push({
        kind: "v1_vs_v2_differs",
        key,
        values: [...values, item.priceDeltaFen],
        templates: [
          ...existing.map(
            (entry) => `${entry.templateName}(${entry.addPriceFen})`,
          ),
          `${item.templateName}(v2:${item.priceDeltaFen})`,
        ],
      });
    }
  }

  const games = new Set(
    templates.filter((t) => t.gameId).map((t) => `${t.tenantId}::${t.gameId}`),
  );

  const v1RuleDetails = rankRules.map((rule) => {
    const template = templatesById.get(rule.templateId);
    return {
      templateName: template?.name ?? "(未知模板)",
      gameId: template?.gameId ?? null,
      status: template?.status ?? null,
      rankLabel: rule.rankLabel,
      addPriceFen: rule.addPriceFen.toString(),
    };
  });

  const v2ByField = new Map();
  for (const item of v2Items) {
    const key = `${item.stableKey} / ${item.optionValue} / ${item.priceDeltaFen}`;
    const entry = v2ByField.get(key) ?? { key, items: 0, templates: new Set() };
    entry.items += 1;
    entry.templates.add(item.templateId);
    v2ByField.set(key, entry);
  }

  const report = {
    database: databaseName,
    mode: "dry-run（只读）",
    counts: {
      templates: templates.length,
      templatesWithoutGame: templates.filter((t) => !t.gameId).length,
      games: games.size,
      v1RankRules: rankRules.length,
      v1RulesSkippedNoGame: skippedNoGame,
      v1DistinctGameRankKeys: byGameRank.size,
      v2OptionSurcharges: v2Items.length,
      v2RankLike: rankLikeV2.length,
      v2NonRank: nonRankV2.length,
      v2FromUnclassified,
    },
    conflicts,
    v1RuleDetails,
    v2ByField: [...v2ByField.values()]
      .map((entry) => ({
        key: entry.key,
        items: entry.items,
        templates: entry.templates.size,
      }))
      .sort((a, b) => b.items - a.items)
      .slice(0, 20),
    v2NonRankSamples: nonRankV2.slice(0, 10),
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.$disconnect();
}
