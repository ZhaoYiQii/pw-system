import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { ReconciliationCaseService } from "../../apps/api/src/modules/payments/application/reconciliation-case.service.js";
import type { ReconciliationCaseStatus } from "../../apps/api/src/modules/payments/domain/reconciliation-case-state.js";
import { PrismaReconciliationCaseRepository } from "../../apps/api/src/modules/payments/infrastructure/prisma-reconciliation-case.repository.js";

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

describe("DS-012 reconciliation case list（真库）", () => {
  const suffix = Date.now().toString(36);
  const tenantIds: string[] = [];
  const sameCreatedAt = new Date("2026-09-25T01:02:03.000Z");
  const olderCreatedAt = new Date("2026-09-24T01:02:03.000Z");
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let service: ReconciliationCaseService;
  let tenantAId: string;
  let tenantBId: string;
  const openCaseIds: string[] = [];
  let claimedCaseId: string;
  let tenantBCaseId: string;

  async function createCase(input: {
    tenantId: string;
    kind: string;
    amountFen: bigint | null;
    status: ReconciliationCaseStatus;
    createdAt: Date;
    detail?: string;
    resolvedAt?: Date;
  }): Promise<string> {
    const caseId = randomUUID();
    await owner.reconciliationDifference.create({
      data: {
        tenantId: input.tenantId,
        kind: input.kind,
        amountFen: input.amountFen,
        detail: input.detail,
        resolvedAt: input.resolvedAt,
        createdAt: input.createdAt,
        case: {
          create: {
            id: caseId,
            tenantId: input.tenantId,
            status: input.status,
            createdAt: input.createdAt,
          },
        },
      },
    });
    return caseId;
  }

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));

    const [tenantA, tenantB] = await Promise.all([
      owner.tenant.create({
        data: { code: `rc_list_a_${suffix}`, name: "处理单列表 A 店" },
      }),
      owner.tenant.create({
        data: { code: `rc_list_b_${suffix}`, name: "处理单列表 B 店" },
      }),
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    tenantIds.push(tenantAId, tenantBId);

    openCaseIds.push(
      await createCase({
        tenantId: tenantAId,
        kind: "AMOUNT_MISMATCH",
        amountFen: 1250n,
        status: "OPEN",
        createdAt: sameCreatedAt,
        detail: "金额差异",
        resolvedAt: olderCreatedAt,
      }),
      await createCase({
        tenantId: tenantAId,
        kind: "MISSING_LOCAL",
        amountFen: null,
        status: "OPEN",
        createdAt: sameCreatedAt,
      }),
    );
    claimedCaseId = await createCase({
      tenantId: tenantAId,
      kind: "MISSING_WECHAT",
      amountFen: 300n,
      status: "CLAIMED",
      createdAt: olderCreatedAt,
    });
    tenantBCaseId = await createCase({
      tenantId: tenantBId,
      kind: "STATUS_MISMATCH",
      amountFen: 9999n,
      status: "OPEN",
      createdAt: new Date("2026-09-26T01:02:03.000Z"),
    });

    service = new ReconciliationCaseService(
      new PrismaReconciliationCaseRepository(runtime),
    );
  });

  afterAll(async () => {
    if (owner) {
      if (tenantIds.length > 0) {
        await owner.reconciliationCase.deleteMany({
          where: { tenantId: { in: tenantIds } },
        });
        await owner.reconciliationDifference.deleteMany({
          where: { tenantId: { in: tenantIds } },
        });
        await owner.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      }
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("只返回当前租户，按 createdAt/id 稳定倒序并序列化金额与日期", async () => {
    const result = await service.list({
      tenantId: tenantAId,
      page: "1",
      pageSize: "10",
    });
    const expectedOpenIds = [...openCaseIds].sort((a, b) => b.localeCompare(a));

    expect(result.total).toBe(3);
    expect(result.rows.map((row) => row.id)).toEqual([
      ...expectedOpenIds,
      claimedCaseId,
    ]);
    expect(result.rows.map((row) => row.id)).not.toContain(tenantBCaseId);

    const amountRow = result.rows.find(
      (row) => row.difference.kind === "AMOUNT_MISMATCH",
    );
    expect(amountRow?.difference.amountFen).toBe("1250");
    expect(amountRow?.difference.createdAt).toBe(sameCreatedAt.toISOString());
    expect(amountRow?.difference.resolvedAt).toBe(olderCreatedAt.toISOString());
    expect(amountRow?.createdAt).toBe(sameCreatedAt.toISOString());
  });

  it("状态过滤与分页共享同一口径，时间相同时按 id 稳定翻页", async () => {
    const expectedOpenIds = [...openCaseIds].sort((a, b) => b.localeCompare(a));
    const page1 = await service.list({
      tenantId: tenantAId,
      status: "OPEN",
      page: "1",
      pageSize: "1",
    });
    const page2 = await service.list({
      tenantId: tenantAId,
      status: "OPEN",
      page: "2",
      pageSize: "1",
    });

    expect(page1).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(page2).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page1.rows.map((row) => row.id)).toEqual([expectedOpenIds[0]]);
    expect(page2.rows.map((row) => row.id)).toEqual([expectedOpenIds[1]]);
  });
});
