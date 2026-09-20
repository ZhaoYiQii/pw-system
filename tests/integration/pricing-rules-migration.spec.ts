/**
 * 算价模型存量导入（ADR-0003 迁移方式）：
 * v1 段位规则与 v2 模板选项价归并成「按游戏」的 SURCHARGE 规则项，未归类模板跳过并报告，
 * 同游戏同命中键金额分歧只报告不自动裁决；写入幂等可重跑。
 */
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import {
  applyPricingRulePlan,
  buildPricingRulePlan,
  type PricingMigrationTemplate,
  type PricingRulePlan,
} from "../../scripts/pricing-rules-plan.mjs";

const suffix = Date.now().toString(36);

function template(
  overrides: Partial<PricingMigrationTemplate>,
): PricingMigrationTemplate {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    tenantId: "tenant-a",
    gameId: "game-1",
    name: "模板",
    archivedAt: null,
    activeVersionId: null,
    draftConfigJson: null,
    ...overrides,
  };
}

/** 一个含单价选项的 v2 配置（FIELD + SINGLE_SELECT + priceDeltaFen）。 */
function configWithOption(
  stableKey: string,
  options: { value: string; priceDeltaFen?: string }[],
) {
  return {
    schemaVersion: 2,
    components: [
      {
        kind: "FIELD",
        stableKey,
        fieldType: "SINGLE_SELECT",
        options: options.map((option) => ({
          value: option.value,
          label: option.value,
          ...(option.priceDeltaFen === undefined
            ? {}
            : { priceDeltaFen: option.priceDeltaFen }),
        })),
      },
    ],
  };
}

describe("存量加价归并：规划口径", () => {
  it("v1 段位与 v2 选项价归并到同一游戏，命中键分别为 rank=<label> 与 <stableKey>=<value>", () => {
    const plan = buildPricingRulePlan({
      templates: [
        template({ id: "t1", gameId: "game-1", name: "经典段位模板" }),
        template({
          id: "t2",
          gameId: "game-1",
          name: "通用模板",
          draftConfigJson: configWithOption("mode", [
            { value: "ranked", priceDeltaFen: "1500" },
            { value: "normal" },
          ]),
        }),
      ],
      versions: [],
      rankRules: [
        {
          tenantId: "tenant-a",
          templateId: "t1",
          rankLabel: "钻石",
          addPriceFen: "2000",
        },
      ],
    });

    expect(plan.games).toHaveLength(1);
    const game = plan.games[0];
    expect(game?.gameId).toBe("game-1");
    expect(game?.conflicts).toEqual([]);
    expect(
      game?.items.map((item) => [item.dimensionKey, item.amountFen]).sort(),
    ).toEqual([
      ["mode=ranked", "1500"],
      ["rank=钻石", "2000"],
    ]);
  });

  it("同游戏同命中键的多条来源只有金额一致时才归并成一条", () => {
    const plan = buildPricingRulePlan({
      templates: [
        template({
          id: "t1",
          gameId: "game-1",
          name: "模板一",
          draftConfigJson: configWithOption("mode", [
            { value: "ranked", priceDeltaFen: "1500" },
          ]),
        }),
        template({
          id: "t2",
          gameId: "game-1",
          name: "模板二",
          draftConfigJson: configWithOption("mode", [
            { value: "ranked", priceDeltaFen: "1500" },
          ]),
        }),
      ],
      versions: [],
      rankRules: [],
    });

    expect(plan.games[0]?.items).toHaveLength(1);
    expect(plan.games[0]?.items[0]?.sources).toHaveLength(2);
    expect(plan.conflicts).toEqual([]);
  });

  it("未归类模板只报告不落地：游戏为空的模板不进规则库，也不生成兜底规则", () => {
    const plan = buildPricingRulePlan({
      templates: [
        template({
          id: "t1",
          gameId: null,
          name: "未归类",
          draftConfigJson: configWithOption("mode", [
            { value: "ranked", priceDeltaFen: "1500" },
          ]),
        }),
      ],
      versions: [],
      rankRules: [
        {
          tenantId: "tenant-a",
          templateId: "t1",
          rankLabel: "钻石",
          addPriceFen: "2000",
        },
      ],
    });

    expect(plan.games).toEqual([]);
    expect(plan.skipped.unclassifiedTemplates).toBe(1);
    expect(plan.skipped.unclassifiedRankRules).toBe(1);
    expect(plan.skipped.unclassifiedOptionPrices).toBe(1);
  });

  it("同游戏同命中键金额分歧：进入 conflicts 且该游戏整条不写入", () => {
    const plan = buildPricingRulePlan({
      templates: [
        template({
          id: "t1",
          gameId: "game-1",
          name: "模板一",
          draftConfigJson: configWithOption("mode", [
            { value: "ranked", priceDeltaFen: "1500" },
          ]),
        }),
        template({
          id: "t2",
          gameId: "game-1",
          name: "模板二",
          draftConfigJson: configWithOption("mode", [
            { value: "ranked", priceDeltaFen: "1800" },
          ]),
        }),
      ],
      versions: [],
      rankRules: [],
    });

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.dimensionKey).toBe("mode=ranked");
    expect(plan.conflicts[0]?.amounts.sort()).toEqual(["1500", "1800"]);
    expect(plan.games[0]?.conflicts).toHaveLength(1);
    expect(plan.games[0]?.items).toEqual([]);
  });

  it("已归档模板不参与归并", () => {
    const plan = buildPricingRulePlan({
      templates: [
        template({
          id: "t1",
          gameId: "game-1",
          name: "已归档",
          archivedAt: new Date("2026-01-01T00:00:00.000Z"),
          draftConfigJson: configWithOption("mode", [
            { value: "ranked", priceDeltaFen: "1500" },
          ]),
        }),
      ],
      versions: [],
      rankRules: [],
    });
    expect(plan.games).toEqual([]);
  });
});

describe("存量加价归并：幂等写入", () => {
  let client: PrismaClient;
  let tenantId = "";
  let gameId = "";
  let conflictGameId = "";

  beforeAll(async () => {
    client = createDatabaseClient(
      process.env.PW_TEST_MIGRATION_URL ??
        (() => {
          throw new Error("missing env PW_TEST_MIGRATION_URL");
        })(),
    );
    const tenant = await client.tenant.create({
      data: { code: `pm_${suffix}`, name: "存量归并测试店" },
    });
    tenantId = tenant.id;
    const game = await client.game.create({
      data: { tenantId, name: `归并游戏-${suffix}` },
    });
    gameId = game.id;
    const conflictGame = await client.game.create({
      data: { tenantId, name: `归并冲突游戏-${suffix}` },
    });
    conflictGameId = conflictGame.id;
  });

  afterAll(async () => {
    if (!client) return;
    await client.gamePricingRuleItem.deleteMany({ where: { tenantId } });
    await client.gamePricingRule.deleteMany({ where: { tenantId } });
    await client.auditLog.deleteMany({ where: { tenantId } });
    await client.game.deleteMany({ where: { tenantId } });
    await client.tenant.deleteMany({ where: { id: tenantId } });
    await client.$disconnect();
  });

  function planFor(
    targets: {
      game: string;
      items: { dimensionKey: string; amountFen: string }[];
    }[],
  ): PricingRulePlan {
    return {
      games: targets.map((target) => ({
        tenantId,
        gameId: target.game,
        items: target.items.map((item) => ({ ...item, sources: ["test"] })),
        conflicts: [],
      })),
      conflicts: [],
      skipped: {
        unclassifiedTemplates: 0,
        unclassifiedRankRules: 0,
        unclassifiedOptionPrices: 0,
      },
    };
  }

  it("写入规则库并记录审计；重跑同一份计划结果不变（幂等）", async () => {
    const plan = planFor([
      {
        game: gameId,
        items: [
          { dimensionKey: "mode=ranked", amountFen: "1500" },
          { dimensionKey: "rank=钻石", amountFen: "2000" },
        ],
      },
    ]);

    const first = await applyPricingRulePlan(client, plan);
    expect(first).toMatchObject({
      writtenGames: 1,
      writtenItems: 2,
      skippedGames: 0,
    });

    const rules = await client.gamePricingRule.findMany({
      where: { tenantId },
    });
    expect(rules).toHaveLength(1);
    const items = await client.gamePricingRuleItem.findMany({
      where: { tenantId },
    });
    expect(items.map((item) => item.dimensionKey).sort()).toEqual([
      "mode=ranked",
      "rank=钻石",
    ]);
    expect(items.every((item) => item.kind === "SURCHARGE")).toBe(true);

    const second = await applyPricingRulePlan(client, plan);
    expect(second).toMatchObject({ writtenGames: 1, writtenItems: 2 });
    const afterRerun = await client.gamePricingRuleItem.findMany({
      where: { tenantId },
    });
    expect(afterRerun).toHaveLength(2);
    const afterRules = await client.gamePricingRule.findMany({
      where: { tenantId },
    });
    expect(afterRules).toHaveLength(1);

    const audits = await client.auditLog.findMany({ where: { tenantId } });
    expect(
      audits.filter((row) => row.action === "game_pricing.rule.migrate"),
    ).toHaveLength(2);
  });

  it("带冲突的游戏整条跳过，写入后规则库仍为空", async () => {
    const plan = planFor([{ game: conflictGameId, items: [] }]);
    plan.games[0]!.conflicts = [
      {
        dimensionKey: "mode=ranked",
        amounts: ["1500", "1800"],
        sources: ["a", "b"],
      },
    ];

    const result = await applyPricingRulePlan(client, plan);
    expect(result).toMatchObject({ writtenGames: 0, skippedGames: 1 });
    expect(
      await client.gamePricingRule.count({
        where: { tenantId, gameId: conflictGameId },
      }),
    ).toBe(0);
  });
});
