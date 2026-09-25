import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenantContext } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import {
  ReconciliationCaseInputError,
  ReconciliationCaseNotFoundError,
} from "../../apps/api/src/modules/payments/application/reconciliation-case-ports.js";
import { ReconciliationCaseService } from "../../apps/api/src/modules/payments/application/reconciliation-case.service.js";
import { PrismaReconciliationCaseRepository } from "../../apps/api/src/modules/payments/infrastructure/prisma-reconciliation-case.repository.js";

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

describe("DS-011 reconciliation case schema and tenant isolation", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let differenceAId: string;
  let differenceBWithCaseId: string;
  let differenceBWithoutCaseId: string;
  let transactionBId: string;
  let caseBId: string;

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));

    const tenantA = await owner.tenant.create({
      data: { code: `rc_a_${suffix}`, name: "对账处理单 A 店" },
    });
    const tenantB = await owner.tenant.create({
      data: { code: `rc_b_${suffix}`, name: "对账处理单 B 店" },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const [differenceA, differenceBWithCase, differenceBWithoutCase] =
      await Promise.all([
        owner.reconciliationDifference.create({
          data: { tenantId: tenantAId, kind: "AMOUNT_MISMATCH" },
        }),
        owner.reconciliationDifference.create({
          data: { tenantId: tenantBId, kind: "MISSING_LOCAL" },
        }),
        owner.reconciliationDifference.create({
          data: { tenantId: tenantBId, kind: "MISSING_WECHAT" },
        }),
      ]);
    differenceAId = differenceA.id;
    differenceBWithCaseId = differenceBWithCase.id;
    differenceBWithoutCaseId = differenceBWithoutCase.id;

    const transactionB = await owner.ledgerTransaction.create({
      data: {
        tenantId: tenantBId,
        txNo: `RC${suffix.toUpperCase()}`,
        description: "DS-011 外键限制验收",
      },
    });
    transactionBId = transactionB.id;

    const reconciliationCase = await owner.reconciliationCase.create({
      data: {
        tenantId: tenantBId,
        differenceId: differenceBWithCaseId,
        linkedTransactionId: transactionBId,
      },
    });
    caseBId = reconciliationCase.id;
  });

  afterAll(async () => {
    if (owner) {
      const tenantIds = [tenantAId, tenantBId].filter(Boolean);
      if (tenantIds.length > 0) {
        await owner.reconciliationCase.deleteMany({
          where: { tenantId: { in: tenantIds } },
        });
        await owner.reconciliationDifference.deleteMany({
          where: { tenantId: { in: tenantIds } },
        });
        await owner.ledgerTransaction.deleteMany({
          where: { tenantId: { in: tenantIds } },
        });
        await owner.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      }
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("表 owner 可读取处理单，且 fund_accounts 与 reconciliation_cases 均启用但不强制 RLS", async () => {
    const reconciliationCase = await owner.reconciliationCase.findUnique({
      where: { id: caseBId },
    });
    expect(reconciliationCase?.tenantId).toBe(tenantBId);
    expect(reconciliationCase?.status).toBe("OPEN");

    const rows = await owner.$queryRaw<
      Array<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>
    >`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('fund_accounts', 'reconciliation_cases')
      ORDER BY c.relname
    `;

    expect(rows).toEqual([
      {
        relname: "fund_accounts",
        relrowsecurity: true,
        relforcerowsecurity: false,
      },
      {
        relname: "reconciliation_cases",
        relrowsecurity: true,
        relforcerowsecurity: false,
      },
    ]);
  });

  it("runtime 只看得到当前租户处理单，无租户上下文时默认不可见", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      expect(
        (await tx.reconciliationCase.findMany()).map((row) => row.id),
      ).not.toContain(caseBId);
    });
    await withTenantContext(runtime, tenantBId, async (tx) => {
      expect(
        (await tx.reconciliationCase.findMany()).map((row) => row.id),
      ).toContain(caseBId);
    });
    expect(await runtime.reconciliationCase.findMany()).toEqual([]);
  });

  it("A 租户不能认领 B 租户处理单，且跨租户尝试不写状态或审计", async () => {
    const service = new ReconciliationCaseService(
      new PrismaReconciliationCaseRepository(runtime),
    );

    await expect(
      service.claim({
        tenantId: tenantAId,
        operatorAccountId: randomUUID(),
        caseId: caseBId,
        body: { expectedVersion: 1 },
      }),
    ).rejects.toBeInstanceOf(ReconciliationCaseNotFoundError);

    expect(
      await owner.reconciliationCase.findUniqueOrThrow({
        where: { id: caseBId },
      }),
    ).toMatchObject({ status: "OPEN", ownerId: null, version: 1 });
    expect(await owner.auditLog.count({ where: { resourceId: caseBId } })).toBe(
      0,
    );
  });

  it("A 租户处理单不能关联 B 租户已确认交易，拒绝后无状态或审计写入", async () => {
    const service = new ReconciliationCaseService(
      new PrismaReconciliationCaseRepository(runtime),
    );
    const operatorAId = randomUUID();
    const caseAId = randomUUID();
    await owner.reconciliationDifference.create({
      data: {
        tenantId: tenantAId,
        kind: "STATUS_MISMATCH",
        case: {
          create: {
            id: caseAId,
            tenantId: tenantAId,
            status: "PROCESSING",
            ownerId: operatorAId,
          },
        },
      },
    });

    await expect(
      service.submitReview({
        tenantId: tenantAId,
        operatorAccountId: operatorAId,
        caseId: caseAId,
        body: {
          expectedVersion: 1,
          resolutionType: "LEDGER_TRANSACTION",
          resolutionNote: "尝试跨租户关联交易",
          linkedTransactionId: transactionBId,
        },
      }),
    ).rejects.toBeInstanceOf(ReconciliationCaseInputError);

    expect(
      await owner.reconciliationCase.findUniqueOrThrow({
        where: { id: caseAId },
      }),
    ).toMatchObject({
      tenantId: tenantAId,
      status: "PROCESSING",
      version: 1,
      resolutionType: null,
      linkedTransactionId: null,
    });
    expect(
      await owner.auditLog.count({
        where: { tenantId: tenantAId, resourceId: caseAId },
      }),
    ).toBe(0);
  });

  it("runtime 可写本租户处理单，但不能把 A 店上下文写成 B 店资源", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      const created = await tx.reconciliationCase.create({
        data: { tenantId: tenantAId, differenceId: differenceAId },
      });
      expect(created.tenantId).toBe(tenantAId);

      await expect(
        tx.reconciliationCase.create({
          data: {
            tenantId: tenantBId,
            differenceId: differenceBWithoutCaseId,
          },
        }),
      ).rejects.toThrow();
    });
  });

  it("嵌套处理单被租户 RLS 拒绝时，同一写入中的差异也完整回滚", async () => {
    const rollbackMarker = `DS012_ROLLBACK_${suffix}`;

    await expect(
      withTenantContext(runtime, tenantAId, (tx) =>
        tx.reconciliationDifference.create({
          data: {
            tenantId: tenantAId,
            kind: rollbackMarker,
            case: { create: { tenantId: tenantBId } },
          },
        }),
      ),
    ).rejects.toThrow();

    expect(
      await owner.reconciliationDifference.count({
        where: { tenantId: tenantAId, kind: rollbackMarker },
      }),
    ).toBe(0);
  });

  it("difference_id 单列唯一保证同一差异最多一个处理单", async () => {
    await expect(
      owner.reconciliationCase.create({
        data: {
          tenantId: tenantBId,
          differenceId: differenceBWithCaseId,
        },
      }),
    ).rejects.toThrow();
  });

  it("处理单引用的差异与账本交易均受 RESTRICT 外键保护", async () => {
    await expect(
      owner.reconciliationDifference.delete({
        where: { id: differenceBWithCaseId },
      }),
    ).rejects.toThrow();
    await expect(
      owner.ledgerTransaction.delete({ where: { id: transactionBId } }),
    ).rejects.toThrow();
  });
});
