import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { tenantGuarded } from "../../apps/api/src/common/database/tenant-guard.js";
import { PrismaGenericGameTemplateRepository } from "../../apps/api/src/modules/game-dispatch/infrastructure/prisma-generic-game-template.repository.js";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const MINIMAL_DRAFT = {
  schemaVersion: 2,
  sections: [],
  components: [],
  staffingSource: { kind: "FIXED", count: 1 },
};

/** 断言受控错误码；返回错误体用于检查不泄露其他租户信息。 */
async function expectGenericError(
  promise: Promise<unknown>,
  code: string,
): Promise<{ code: string; status: number; details?: unknown }> {
  try {
    await promise;
  } catch (error) {
    const typed = error as {
      code?: string;
      status?: number;
      details?: unknown;
      message?: string;
    };
    expect(typed.code).toBe(code);
    expect(typed.message ?? "").not.toContain("别家模板");
    return {
      code: typed.code as string,
      status: typed.status as number,
      details: typed.details,
    };
  }
  throw new Error(`expected failure with code ${code}`);
}

describe("tenant isolation for generic dispatch template v2", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let actorAId: string;
  let gameAId: string;
  let gameBId: string;
  let templateAId: string;
  let templateBId: string;
  let repository: PrismaGenericGameTemplateRepository;

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const a = await owner.tenant.create({
      data: { code: `gdv2_iso_a_${suffix}`, name: "隔离 A 店" },
    });
    const b = await owner.tenant.create({
      data: { code: `gdv2_iso_b_${suffix}`, name: "隔离 B 店" },
    });
    tenantAId = a.id;
    tenantBId = b.id;

    const account = await owner.tenantAccount.create({
      data: { tenantId: a.id, username: `boss_${suffix}`, passwordHash: "x" },
    });
    actorAId = account.id;

    const gameA = await owner.game.create({
      data: { tenantId: a.id, name: `A 游戏 ${suffix}` },
    });
    const gameB = await owner.game.create({
      data: { tenantId: b.id, name: `B 游戏 ${suffix}` },
    });
    gameAId = gameA.id;
    gameBId = gameB.id;

    const templateA = await owner.gameDispatchTemplate.create({
      data: {
        tenantId: a.id,
        gameId: gameA.id,
        name: `A 店模板 ${suffix}`,
        copyLines: [],
        draftConfigJson: MINIMAL_DRAFT,
        draftSchemaVersion: 2,
      },
    });
    const templateB = await owner.gameDispatchTemplate.create({
      data: {
        tenantId: b.id,
        gameId: gameB.id,
        name: `别家模板 ${suffix}`,
        copyLines: [],
        draftConfigJson: MINIMAL_DRAFT,
        draftSchemaVersion: 2,
      },
    });
    templateAId = templateA.id;
    templateBId = templateB.id;

    repository = tenantGuarded(
      runtime,
      new PrismaGenericGameTemplateRepository(runtime),
    );
  });

  afterAll(async () => {
    if (owner) {
      const tids = [tenantAId, tenantBId];
      await owner.gameDispatchTemplateVersion.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.gameDispatchTemplate.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.auditLog.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.tenantAccountRole.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.tenantAccount.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.game.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.tenant.deleteMany({ where: { id: { in: tids } } });
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("list：A 店上下文只返回本租户模板", async () => {
    const page = await repository.list(tenantAId, {
      sort: "UPDATED_DESC",
      limit: 100,
    });
    const ids = page.data.map((row) => row.id);
    expect(ids).toContain(templateAId);
    expect(ids).not.toContain(templateBId);
  });

  it("list：A 店用 B 店关键词搜索也读不到 B 店模板", async () => {
    const page = await repository.list(tenantAId, {
      q: `别家模板 ${suffix}`,
      sort: "UPDATED_DESC",
      limit: 100,
    });
    expect(page.data.map((row) => row.id)).not.toContain(templateBId);
  });

  it("get：A 店上下文读取 B 店模板返回 404 且不泄露名称", async () => {
    const error = await expectGenericError(
      repository.getDraft(tenantAId, templateBId),
      "TEMPLATE_NOT_FOUND",
    );
    expect(error.status).toBe(404);
  });

  it("save：A 店上下文无法修改 B 店模板，数据库不被覆盖", async () => {
    await expectGenericError(
      repository.saveDraft(tenantAId, actorAId, templateBId, {
        expectedRevision: 1,
        config: MINIMAL_DRAFT as never,
      }),
      "TEMPLATE_NOT_FOUND",
    );
    const untouched = await owner.gameDispatchTemplate.findUniqueOrThrow({
      where: { id: templateBId },
    });
    expect(untouched.revision).toBe(1);
    expect(untouched.tenantId).toBe(tenantBId);
  });

  it("create：A 店无法把模板挂到 B 店游戏", async () => {
    await expectGenericError(
      repository.createDraft(tenantAId, actorAId, {
        gameId: gameBId,
        name: `越权挂载 ${suffix}`,
      }),
      "TEMPLATE_BINDING_INVALID",
    );
    const leaked = await owner.gameDispatchTemplate.findFirst({
      where: { name: `越权挂载 ${suffix}` },
    });
    expect(leaked).toBeNull();
  });

  it("审计：越权尝试不写入其他租户审计", async () => {
    const rows = await owner.auditLog.findMany({
      where: { tenantId: tenantBId },
    });
    expect(rows).toHaveLength(0);
  });

  it("生命周期动作：A 店无法对 B 店模板 restore/copy/default/archive/unarchive/delete", async () => {
    const versionB = await owner.gameDispatchTemplateVersion.create({
      data: {
        tenantId: tenantBId,
        templateId: templateBId,
        versionNo: 1,
        configJson: {
          schemaVersion: 2,
          sections: [],
          components: [],
          staffingSource: { kind: "FIXED", count: 1 },
          documentRendererVersion: 1,
        },
      },
    });
    const expectedRevision = 1;

    const attempts: Array<() => Promise<unknown>> = [
      () =>
        repository.restoreVersion(
          tenantAId,
          actorAId,
          templateBId,
          { versionId: versionB.id, expectedRevision },
          () => MINIMAL_DRAFT as never,
        ),
      () =>
        repository.copyTemplate(tenantAId, actorAId, templateBId, {
          targetGameId: gameAId,
          newName: `越权复制 ${suffix}`,
        }),
      () =>
        repository.setDefault(tenantAId, actorAId, templateBId, {
          expectedRevision,
        }),
      () =>
        repository.archiveTemplate(tenantAId, actorAId, templateBId, {
          expectedRevision,
        }),
      () =>
        repository.unarchiveTemplate(tenantAId, actorAId, templateBId, {
          expectedRevision,
        }),
      () =>
        repository.deleteTemplate(tenantAId, actorAId, templateBId, {
          expectedRevision,
        }),
    ];

    for (const attempt of attempts) {
      await expectGenericError(attempt(), "TEMPLATE_NOT_FOUND");
    }

    const untouched = await owner.gameDispatchTemplate.findFirst({
      where: { tenantId: tenantBId, id: templateBId },
    });
    expect(untouched).not.toBeNull();
    expect(untouched?.revision).toBe(1);
    expect(untouched?.status).toBe("DRAFT");
    expect(untouched?.archivedAt).toBeNull();
    expect(untouched?.isDefault).toBe(false);
    expect(untouched?.activeVersionId).toBeNull();
    expect(
      await owner.gameDispatchTemplate.count({
        where: { tenantId: tenantAId, name: `越权复制 ${suffix}` },
      }),
    ).toBe(0);
    expect(await owner.auditLog.count({ where: { tenantId: tenantBId } })).toBe(
      0,
    );
  });
});
