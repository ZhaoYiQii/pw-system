import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { tenantGuarded } from "../../apps/api/src/common/database/tenant-guard.js";
import type { PublishedConfigV2 } from "../../apps/api/src/modules/game-dispatch/domain/game-template-config-v2.js";
import { buildTemplateOrderDraftForAudience } from "../../apps/api/src/modules/game-dispatch/domain/game-template-order-draft.js";
import { DispatchInputError } from "../../apps/api/src/modules/game-dispatch/domain/dispatch-errors.js";
import { PrismaGameDispatchTemplateOrderRepository } from "../../apps/api/src/modules/game-dispatch/infrastructure/prisma-game-dispatch-template-order.repository.js";
import { TEMPLATE_ORDER_OPERATION_BY_AUDIENCE } from "../../apps/api/src/modules/game-dispatch/application/game-dispatch-template-order.service.js";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

/**
 * 仓储端口回调的替身：与应用层同样的写法——按写入方端口（客服）产出草稿、
 * 落库值与被丢弃的键。回调返回的 `storedValues` 是仓储写入 `formValuesJson` 的来源。
 */
function buildTemplateOrderDraft(
  config: PublishedConfigV2,
  values: Record<string, unknown>,
) {
  return buildTemplateOrderDraftForAudience(config, values, "CS");
}

/** 一个最小但完整可下单的发布配置：固定人数 1。 */
const PUBLISHED_CONFIG = {
  schemaVersion: 2,
  documentRendererVersion: 1,
  sections: [],
  components: [],
  staffingSource: { kind: "FIXED", count: 1 },
};

async function expectCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const typed = error as { code?: string };
    expect(typed.code).toBe(code);
    return;
  }
  throw new Error(`expected failure with code ${code}`);
}

describe("tenant isolation for S4 template order creation", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId = "";
  let tenantBId = "";
  let actorAId = "";
  let gameAId = "";
  let templateAId = "";
  let versionAId = "";
  let templateBId = "";
  let versionBId = "";
  let customerAId = "";
  let customerBId = "";
  let repository: PrismaGameDispatchTemplateOrderRepository;

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));

    const a = await owner.tenant.create({
      data: { code: `s4_iso_a_${suffix}`, name: "S4 隔离 A 店" },
    });
    const b = await owner.tenant.create({
      data: { code: `s4_iso_b_${suffix}`, name: "S4 隔离 B 店" },
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

    const templateA = await owner.gameDispatchTemplate.create({
      data: {
        tenantId: a.id,
        gameId: gameA.id,
        name: `A 店下单模板 ${suffix}`,
        copyLines: [],
        draftConfigJson: PUBLISHED_CONFIG,
        draftSchemaVersion: 2,
      },
    });
    const templateB = await owner.gameDispatchTemplate.create({
      data: {
        tenantId: b.id,
        gameId: gameB.id,
        name: `别家下单模板 ${suffix}`,
        copyLines: [],
        draftConfigJson: PUBLISHED_CONFIG,
        draftSchemaVersion: 2,
      },
    });
    templateAId = templateA.id;
    templateBId = templateB.id;

    const versionA = await owner.gameDispatchTemplateVersion.create({
      data: {
        tenantId: a.id,
        templateId: templateA.id,
        versionNo: 1,
        configJson: PUBLISHED_CONFIG,
      },
    });
    const versionB = await owner.gameDispatchTemplateVersion.create({
      data: {
        tenantId: b.id,
        templateId: templateB.id,
        versionNo: 1,
        configJson: PUBLISHED_CONFIG,
      },
    });
    versionAId = versionA.id;
    versionBId = versionB.id;
    await owner.gameDispatchTemplate.update({
      where: { id: templateA.id },
      data: { activeVersionId: versionA.id },
    });
    await owner.gameDispatchTemplate.update({
      where: { id: templateB.id },
      data: { activeVersionId: versionB.id },
    });

    const customerA = await owner.customerProfile.create({
      data: { tenantId: a.id, name: "A 店客户" },
    });
    const customerB = await owner.customerProfile.create({
      data: { tenantId: b.id, name: "别家客户" },
    });
    customerAId = customerA.id;
    customerBId = customerB.id;

    repository = tenantGuarded(
      runtime,
      new PrismaGameDispatchTemplateOrderRepository(runtime),
    );
  });

  afterAll(async () => {
    if (owner) {
      const tids = [tenantAId, tenantBId].filter((id) => id !== "");
      await owner.gameDispatchTemplateSnapshot.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.gameDispatchOrder.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.idempotencyRecord.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.order.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.customerProfile.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.gameDispatchTemplate.updateMany({
        where: { tenantId: { in: tids } },
        data: { activeVersionId: null },
      });
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

  function command(overrides: {
    tenantId?: string;
    templateId?: string;
    versionId?: string;
    customerId?: string;
    idempotencyKey: string;
  }) {
    return {
      tenantId: overrides.tenantId ?? tenantAId,
      actorId: actorAId,
      idempotencyKey: overrides.idempotencyKey,
      // 幂等 operation 按入口区分（C-8）：这条用例走的是客服侧入口。
      operation: TEMPLATE_ORDER_OPERATION_BY_AUDIENCE.CS,
      input: {
        gameId: gameAId,
        templateId: overrides.templateId ?? templateAId,
        templateVersionId: overrides.versionId ?? versionAId,
        customerProfileId: overrides.customerId ?? customerAId,
        values: {},
      },
      requestHash: "hash-1",
    };
  }

  it("A 店上下文创建成功，且只写入 A 店数据", async () => {
    const created = await repository.createFromPublishedVersion(
      command({ idempotencyKey: `iso-a-${suffix}` }),
      buildTemplateOrderDraft,
    );

    expect(created.duplicate).toBe(false);
    expect(created.result.staffingSummary.total).toBe(1);
    expect(created.result.priceAdjustmentFen).toBe("0");

    const aOrders = await owner.gameDispatchOrder.count({
      where: { tenantId: tenantAId },
    });
    const bOrders = await owner.gameDispatchOrder.count({
      where: { tenantId: tenantBId },
    });
    expect(aOrders).toBe(1);
    expect(bOrders).toBe(0);
  });

  it("A 店上下文用 B 店模板 id 时按不存在处理，B 店数据零变化", async () => {
    await expectCode(
      repository.createFromPublishedVersion(
        command({
          templateId: templateBId,
          versionId: versionBId,
          idempotencyKey: `iso-b-template-${suffix}`,
        }),
        buildTemplateOrderDraft,
      ),
      "TEMPLATE_NOT_FOUND",
    );

    expect(
      await owner.gameDispatchOrder.count({ where: { tenantId: tenantBId } }),
    ).toBe(0);
  });

  it("A 店模板配 B 店版本时 422 TEMPLATE_VERSION_UNAVAILABLE", async () => {
    await expectCode(
      repository.createFromPublishedVersion(
        command({
          versionId: versionBId,
          idempotencyKey: `iso-b-version-${suffix}`,
        }),
        buildTemplateOrderDraft,
      ),
      "TEMPLATE_VERSION_UNAVAILABLE",
    );
  });

  it("A 店上下文不能用 B 店客户创建派单", async () => {
    try {
      await repository.createFromPublishedVersion(
        command({
          customerId: customerBId,
          idempotencyKey: `iso-b-customer-${suffix}`,
        }),
        buildTemplateOrderDraft,
      );
      throw new Error("expected DispatchInputError");
    } catch (error) {
      expect(error).toBeInstanceOf(DispatchInputError);
    }
  });
});
