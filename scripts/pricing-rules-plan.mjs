/**
 * 算价模型（ADR-0003）存量加价归并：纯规划 + 幂等写入。
 *
 * 归并口径（与只读干跑一致，见 docs/specs/算价模型-设计规格-v0.1.md §5）：
 * - v1 模板级段位规则 game_dispatch_rank_rules → `rank=<rankLabel>`；
 * - v2 模板配置里选项的 priceDeltaFen → `<stableKey>=<optionValue>`（现网实际形态是 mode=ranked）；
 * - 一律按 templateId → game_id 归并到游戏维度；game_id 为空的未归类模板跳过并报告，不落地兜底规则；
 * - 同游戏同命中键出现不同金额时只报告、不自动裁决：该游戏整条不写入，人工在规则库页确认后重跑；
 * - 已归档模板不参与归并；同键同金额的多条来源合并成一条规则项（幂等输入）。
 */

/** v2 配置里带加价的选项（只取 FIELD 的单选/多选，与干跑口径一致）。 */
export function optionSurcharges(config) {
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
    const stableKey =
      typeof component.stableKey === "string" ? component.stableKey : "";
    if (stableKey.length === 0) continue;
    for (const option of Array.isArray(component.options)
      ? component.options
      : []) {
      const price = option?.priceDeltaFen;
      if (typeof price !== "string" || price === "0") continue;
      const optionValue = String(option?.value ?? "");
      if (optionValue.length === 0) continue;
      items.push({ stableKey, optionValue, priceDeltaFen: price });
    }
  }
  return items;
}

/**
 * 把 v1 段位规则与 v2 选项价归并成「按游戏」的规则项计划。
 * 纯函数：不连数据库，便于单测与干跑复用。
 */
export function buildPricingRulePlan({
  templates = [],
  versions = [],
  rankRules = [],
} = {}) {
  const templatesById = new Map(templates.map((row) => [row.id, row]));
  const versionsById = new Map(versions.map((row) => [row.id, row]));
  const byGame = new Map();
  const unclassifiedTemplates = new Set();
  const skipped = {
    unclassifiedTemplates: 0,
    unclassifiedRankRules: 0,
    unclassifiedOptionPrices: 0,
  };
  const conflicts = [];

  const add = (tenantId, gameId, dimensionKey, amountFen, source) => {
    const gameKey = `${tenantId}::${gameId}`;
    const entry = byGame.get(gameKey) ?? {
      tenantId,
      gameId,
      keys: new Map(),
    };
    const collected = entry.keys.get(dimensionKey) ?? {
      amounts: new Set(),
      sources: new Set(),
    };
    collected.amounts.add(String(amountFen));
    collected.sources.add(source);
    entry.keys.set(dimensionKey, collected);
    byGame.set(gameKey, entry);
  };

  for (const rule of rankRules) {
    const template = templatesById.get(rule.templateId);
    if (!template) continue;
    if (!template.gameId) {
      skipped.unclassifiedRankRules += 1;
      unclassifiedTemplates.add(template.id);
      continue;
    }
    add(
      template.tenantId,
      template.gameId,
      `rank=${rule.rankLabel}`,
      rule.addPriceFen.toString(),
      `v1:${template.name}`,
    );
  }

  for (const template of templates) {
    if (template.archivedAt) continue;
    const published = template.activeVersionId
      ? versionsById.get(template.activeVersionId)?.configJson
      : null;
    const configs = [];
    if (published) configs.push(published);
    if (template.draftConfigJson) configs.push(template.draftConfigJson);
    for (const config of configs) {
      for (const item of optionSurcharges(config)) {
        if (!template.gameId) {
          skipped.unclassifiedOptionPrices += 1;
          unclassifiedTemplates.add(template.id);
          continue;
        }
        add(
          template.tenantId,
          template.gameId,
          `${item.stableKey}=${item.optionValue}`,
          item.priceDeltaFen,
          `v2:${template.name}`,
        );
      }
    }
  }

  const games = [];
  for (const entry of byGame.values()) {
    const items = [];
    const gameConflicts = [];
    const keys = [...entry.keys.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const [dimensionKey, collected] of keys) {
      const amounts = [...collected.amounts].sort();
      const sources = [...collected.sources].sort();
      if (amounts.length > 1) {
        const conflict = {
          tenantId: entry.tenantId,
          gameId: entry.gameId,
          dimensionKey,
          amounts,
          sources,
        };
        gameConflicts.push(conflict);
        conflicts.push(conflict);
        continue;
      }
      items.push({ dimensionKey, amountFen: amounts[0] ?? "0", sources });
    }
    games.push({
      tenantId: entry.tenantId,
      gameId: entry.gameId,
      items,
      conflicts: gameConflicts,
    });
  }
  games.sort((left, right) =>
    `${left.tenantId}::${left.gameId}` < `${right.tenantId}::${right.gameId}`
      ? -1
      : 1,
  );

  return {
    games,
    conflicts,
    skipped: { ...skipped, unclassifiedTemplates: unclassifiedTemplates.size },
  };
}

/**
 * 幂等写入：每个游戏一个事务（upsert 规则行 → 整表替换规则项 → 写审计）。
 * 带冲突的游戏整条跳过（只报告，不自动裁决）。
 */
export async function applyPricingRulePlan(client, plan) {
  let writtenGames = 0;
  let writtenItems = 0;
  let skippedGames = 0;
  for (const game of plan.games) {
    if (game.conflicts.length > 0) {
      skippedGames += 1;
      continue;
    }
    const ruleId = await client.$transaction(async (tx) => {
      const rule = await tx.gamePricingRule.upsert({
        where: {
          tenantId_gameId: { tenantId: game.tenantId, gameId: game.gameId },
        },
        create: {
          tenantId: game.tenantId,
          gameId: game.gameId,
          enabled: true,
        },
        update: { enabled: true, version: { increment: 1 } },
      });
      await tx.gamePricingRuleItem.deleteMany({
        where: { tenantId: game.tenantId, ruleId: rule.id },
      });
      if (game.items.length > 0) {
        await tx.gamePricingRuleItem.createMany({
          data: game.items.map((item, index) => ({
            tenantId: game.tenantId,
            ruleId: rule.id,
            kind: "SURCHARGE",
            dimensionKey: item.dimensionKey,
            amountFen: BigInt(item.amountFen),
            sortOrder: index,
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: game.tenantId,
          actorType: null,
          actorId: null,
          action: "game_pricing.rule.migrate",
          resourceType: "game_pricing_rule",
          resourceId: rule.id,
          summary: `存量加价归并（脚本）：${game.items.length} 条规则项`,
        },
      });
      return rule.id;
    });
    if (ruleId) {
      writtenGames += 1;
      writtenItems += game.items.length;
    }
  }
  return { writtenGames, writtenItems, skippedGames };
}
