// 算价模型（ADR-0003）：把"模板级"加价来源归并成"按游戏"的定价规则库。
//
// 用法：
//   DATABASE_URL=postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public \
//   node scripts/migrate-pricing-rules.mjs            # 只读干跑（默认，安全）
//
//   node scripts/migrate-pricing-rules.mjs --apply    # 写入规则库（幂等，可重跑）
//
// 安全边界：
// - 只允许已授权的一次性测试库（库名守卫），与 scripts/audit-template-v2.mjs 一致；
// - 干跑模式纯只读，不写库；输出仅含模板/字段标识与金额，不含客户资料与订单值；
// - 同游戏同命中键出现金额分歧时只报告、不自动裁决：该游戏整条不写入，人工确认后重跑；
// - 未归类模板（game_id 为空）跳过并报告，不落地"未归类兜底规则"。
import { createDatabaseClient } from "@pw/database";
import {
  applyPricingRulePlan,
  buildPricingRulePlan,
  optionSurcharges,
} from "./pricing-rules-plan.mjs";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const databaseName = new URL(url).pathname.replace(/^\//, "");
if (databaseName !== "pw_saas_s2_task2_20260916") {
  throw new Error(`refusing to run against database: ${databaseName}`);
}
const apply = process.argv.includes("--apply");

const client = createDatabaseClient(url);

/** v2 报告辅助：区分"段位类字段"与其它字段（只影响报告措辞）。 */
function isRankLike(component) {
  const stableKey = String(component?.stableKey ?? "").toLowerCase();
  const label = String(component?.label ?? "");
  return stableKey.includes("rank") || label.includes("段位");
}

try {
  const [templates, versions, rankRules, games] = await Promise.all([
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
    client.game.findMany({ select: { id: true, name: true } }),
  ]);

  const templatesById = new Map(templates.map((row) => [row.id, row]));
  const versionsById = new Map(versions.map((row) => [row.id, row]));
  const gameNames = new Map(games.map((row) => [row.id, row.name]));
  const plan = buildPricingRulePlan({ templates, versions, rankRules });

  const v2Items = [];
  for (const template of templates) {
    if (template.archivedAt) continue;
    const published = template.activeVersionId
      ? versionsById.get(template.activeVersionId)?.configJson
      : null;
    const configs = [];
    if (published) configs.push({ config: published, source: "published" });
    if (template.draftConfigJson) {
      configs.push({ config: template.draftConfigJson, source: "draft" });
    }
    for (const { config, source } of configs) {
      const components = Array.isArray(config?.components)
        ? config.components
        : [];
      for (const component of components) {
        for (const item of optionSurcharges({ components: [component] })) {
          v2Items.push({
            ...item,
            source,
            rankLike: isRankLike(component),
            templateId: template.id,
            templateName: template.name,
            gameId: template.gameId,
          });
        }
      }
    }
  }

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
    mode: apply ? "apply（写入规则库）" : "dry-run（只读）",
    counts: {
      templates: templates.length,
      templatesWithoutGame: templates.filter((row) => !row.gameId).length,
      gamesWithRules: plan.games.length,
      v1RankRules: rankRules.length,
      v2OptionSurcharges: v2Items.length,
      plannedGames: plan.games.filter((game) => game.conflicts.length === 0)
        .length,
      plannedItems: plan.games
        .filter((game) => game.conflicts.length === 0)
        .reduce((total, game) => total + game.items.length, 0),
    },
    skipped: plan.skipped,
    conflicts: plan.conflicts,
    plan: plan.games.map((game) => ({
      tenantId: game.tenantId,
      gameId: game.gameId,
      gameName: gameNames.get(game.gameId) ?? null,
      writable: game.conflicts.length === 0,
      items: game.items,
      conflicts: game.conflicts,
    })),
    v1RuleDetails: rankRules.map((rule) => {
      const template = templatesById.get(rule.templateId);
      return {
        templateName: template?.name ?? "(未知模板)",
        gameId: template?.gameId ?? null,
        status: template?.status ?? null,
        rankLabel: rule.rankLabel,
        addPriceFen: rule.addPriceFen.toString(),
      };
    }),
    v2ByField: [...v2ByField.values()]
      .map((entry) => ({
        key: entry.key,
        items: entry.items,
        templates: entry.templates.size,
      }))
      .sort((left, right) => right.items - left.items)
      .slice(0, 20),
    v2NonRankSamples: v2Items.filter((item) => !item.rankLike).slice(0, 10),
  };

  if (!apply) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const result = await applyPricingRulePlan(client, plan);
    const writtenRules = await client.gamePricingRule.findMany({
      where: {
        tenantId: { in: [...new Set(plan.games.map((g) => g.tenantId))] },
      },
      select: { id: true, tenantId: true, gameId: true },
    });
    const writtenItems = await client.gamePricingRuleItem.count({
      where: {
        tenantId: { in: [...new Set(plan.games.map((g) => g.tenantId))] },
      },
    });
    console.log(
      JSON.stringify(
        {
          ...report,
          applied: {
            ...result,
            rulesInDb: writtenRules.length,
            itemsInDb: writtenItems,
          },
        },
        null,
        2,
      ),
    );
  }
} finally {
  await client.$disconnect();
}
