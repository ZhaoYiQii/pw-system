import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabaseClient,
  withTenantContext,
  type PrismaClient,
} from "@pw/database";

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("missing env " + name);
  return value;
}

describe("multi-game template v2 schema", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId = "";
  let tenantBId = "";
  let gameA1Id = "";
  let gameA2Id = "";
  let gameBId = "";
  let templateA1Id = "";
  let templateA2Id = "";
  let templateBId = "";
  let versionA1Id = "";
  let customerAId = "";
  let orderAId = "";

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));

    const [tenantA, tenantB] = await Promise.all([
      owner.tenant.create({
        data: { code: "gdtv2_a_" + suffix, name: "模板 v2 A 店" },
      }),
      owner.tenant.create({
        data: { code: "gdtv2_b_" + suffix, name: "模板 v2 B 店" },
      }),
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const [gameA1, gameA2, gameB] = await Promise.all([
      owner.game.create({ data: { tenantId: tenantAId, name: "游戏一" } }),
      owner.game.create({ data: { tenantId: tenantAId, name: "游戏二" } }),
      owner.game.create({ data: { tenantId: tenantBId, name: "游戏三" } }),
    ]);
    gameA1Id = gameA1.id;
    gameA2Id = gameA2.id;
    gameBId = gameB.id;

    const customerA = await owner.customerProfile.create({
      data: { tenantId: tenantAId, name: "迁移约束测试客户" },
    });
    customerAId = customerA.id;
    const orderA = await owner.order.create({
      data: {
        tenantId: tenantAId,
        orderNo: "GDT-V2-" + suffix,
        customerProfileId: customerAId,
      },
    });
    orderAId = orderA.id;

    const [templateA1, templateA2, templateB] = await Promise.all([
      owner.gameDispatchTemplate.create({
        data: {
          tenantId: tenantAId,
          gameId: gameA1Id,
          name: "标准上分",
          copyLines: [],
        },
      }),
      owner.gameDispatchTemplate.create({
        data: {
          tenantId: tenantAId,
          gameId: gameA2Id,
          name: "标准上分",
          copyLines: [],
        },
      }),
      owner.gameDispatchTemplate.create({
        data: {
          tenantId: tenantBId,
          gameId: gameBId,
          name: "B 店模板",
          copyLines: [],
        },
      }),
    ]);
    templateA1Id = templateA1.id;
    templateA2Id = templateA2.id;
    templateBId = templateB.id;

    const version = await owner.gameDispatchTemplateVersion.create({
      data: {
        tenantId: tenantAId,
        templateId: templateA1Id,
        versionNo: 1,
        configJson: {
          schemaVersion: 1,
          templateId: templateA1Id,
          gameId: gameA1Id,
          templateName: "标准上分",
          description: null,
          sections: [],
          fields: [],
          positions: [],
          rankRules: [],
          copyLines: [],
          blockLabels: {},
        },
      },
    });
    versionA1Id = version.id;
    await owner.gameDispatchTemplate.update({
      where: { id: templateA1Id },
      data: { activeVersionId: version.id, status: "PUBLISHED" },
    });
  });

  afterAll(async () => {
    if (owner) {
      const tenantIds = [tenantAId, tenantBId].filter(Boolean);
      await owner.gameDispatchTemplate.updateMany({
        where: { tenantId: { in: tenantIds } },
        data: { activeVersionId: null },
      });
      await owner.gameDispatchTemplateSnapshot.deleteMany({
        where: { tenantId: { in: tenantIds } },
      });
      await owner.gameDispatchTemplateField.deleteMany({
        where: { tenantId: { in: tenantIds } },
      });
      await owner.gameDispatchTemplateVersion.deleteMany({
        where: { tenantId: { in: tenantIds } },
      });
      await owner.gameDispatchTemplate.deleteMany({
        where: { tenantId: { in: tenantIds } },
      });
      await owner.order.deleteMany({ where: { id: orderAId } });
      await owner.customerProfile.deleteMany({ where: { id: customerAId } });
      await owner.game.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await owner.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("allows the same normalized template name in different games", async () => {
    const rows = await owner.gameDispatchTemplate.findMany({
      where: { tenantId: tenantAId, normalizedName: "标准上分" },
      orderBy: { gameId: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.gameId))).toEqual(
      new Set([gameA1Id, gameA2Id]),
    );
  });

  it("rejects a duplicate normalized name inside one game", async () => {
    await expect(
      owner.gameDispatchTemplate.create({
        data: {
          tenantId: tenantAId,
          gameId: gameA1Id,
          name: "  标准上分  ",
          copyLines: [],
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects an active version that belongs to another template", async () => {
    await expect(
      owner.gameDispatchTemplate.update({
        where: { id: templateA2Id },
        data: { activeVersionId: versionA1Id },
      }),
    ).rejects.toThrow();
  });

  it("enforces one non-custom semantic role per template", async () => {
    await owner.gameDispatchTemplateField.create({
      data: {
        tenantId: tenantAId,
        templateId: templateA1Id,
        fieldKey: "mode_primary",
        label: "模式",
        fieldType: "select",
        semanticRole: "MODE",
        sortOrder: 0,
      },
    });
    await expect(
      owner.gameDispatchTemplateField.create({
        data: {
          tenantId: tenantAId,
          templateId: templateA1Id,
          fieldKey: "mode_backup",
          label: "备用模式",
          fieldType: "select",
          semanticRole: "MODE",
          sortOrder: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it("keeps published versions isolated by tenant RLS", async () => {
    const versionB = await owner.gameDispatchTemplateVersion.create({
      data: {
        tenantId: tenantBId,
        templateId: templateBId,
        versionNo: 1,
        configJson: { schemaVersion: 1 },
      },
    });

    await withTenantContext(runtime, tenantAId, async (tx) => {
      const visible = await tx.gameDispatchTemplateVersion.findMany();
      expect(visible.map((row) => row.id)).not.toContain(versionB.id);
    });
  });

  it("rejects invalid v2 draft JSON/version pairs", async () => {
    await expect(
      owner.gameDispatchTemplate.update({
        where: { id: templateA1Id },
        data: {
          draftConfigJson: {
            schemaVersion: 2,
            sections: [],
            components: [],
            staffingSource: { kind: "FIXED", count: 1 },
          },
          draftSchemaVersion: null,
        },
      }),
    ).rejects.toThrow();

    await expect(
      owner.gameDispatchTemplate.update({
        where: { id: templateA1Id },
        data: {
          draftConfigJson: { schemaVersion: 1 },
          draftSchemaVersion: 2,
        },
      }),
    ).rejects.toThrow();

    await expect(
      owner.gameDispatchTemplate.update({
        where: { id: templateA1Id },
        data: {
          draftConfigJson: { sections: [], components: [] },
          draftSchemaVersion: 2,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects invalid v2 snapshot JSON/version pairs", async () => {
    const base = {
      tenantId: tenantAId,
      orderId: orderAId,
      templateName: "迁移约束测试模板",
      fieldsJson: [],
      positionsJson: [],
      rankRulesJson: [],
      copyLinesJson: [],
    };

    await expect(
      owner.gameDispatchTemplateSnapshot.create({
        data: {
          ...base,
          configJson: {
            schemaVersion: 2,
            sections: [],
            components: [],
            staffingSource: { kind: "FIXED", count: 1 },
          },
        },
      }),
    ).rejects.toThrow();

    await expect(
      owner.gameDispatchTemplateSnapshot.create({
        data: {
          ...base,
          configJson: { schemaVersion: 1 },
          schemaVersion: 2,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects invalid conversion state and non-array issues", async () => {
    await expect(
      owner.gameDispatchTemplate.update({
        where: { id: templateA1Id },
        data: { legacyConversionState: "DONE" },
      }),
    ).rejects.toThrow();

    await expect(
      owner.gameDispatchTemplate.update({
        where: { id: templateA1Id },
        data: { legacyConversionIssues: { code: "INVALID" } },
      }),
    ).rejects.toThrow();
  });

  it("keeps v2 draft columns isolated by the existing tenant RLS", async () => {
    const hiddenDraft = {
      schemaVersion: 2,
      sections: [],
      components: [],
      staffingSource: { kind: "FIXED", count: 1 },
    };
    await owner.gameDispatchTemplate.update({
      where: { id: templateBId },
      data: {
        draftConfigJson: hiddenDraft,
        draftSchemaVersion: 2,
        legacyConversionState: "READY",
      },
    });

    await withTenantContext(runtime, tenantAId, async (tx) => {
      const visible = await tx.gameDispatchTemplate.findMany({
        where: { id: templateBId },
        select: {
          id: true,
          draftConfigJson: true,
          legacyConversionIssues: true,
        },
      });
      expect(visible).toEqual([]);

      const update = await tx.gameDispatchTemplate.updateMany({
        where: { id: templateBId },
        data: { legacyConversionState: "NEEDS_REVIEW" },
      });
      expect(update.count).toBe(0);
    });

    const unchanged = await owner.gameDispatchTemplate.findUniqueOrThrow({
      where: { id: templateBId },
      select: { legacyConversionState: true },
    });
    expect(unchanged.legacyConversionState).toBe("READY");
  });
});
