import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  createDatabaseClient,
  type DbTransaction,
  type PrismaClient,
} from "@pw/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../apps/api/src/app.module.js";
import {
  ReconciliationCaseConflictError,
  ReconciliationCaseInputError,
  ReconciliationCaseNotFoundError,
} from "../../apps/api/src/modules/payments/application/reconciliation-case-ports.js";
import { ReconciliationCaseService } from "../../apps/api/src/modules/payments/application/reconciliation-case.service.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { PrismaReconciliationCaseRepository } from "../../apps/api/src/modules/payments/infrastructure/prisma-reconciliation-case.repository.js";

const PASSWORD = "Ds013-Password-1";

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function auditFailingRuntime(runtime: PrismaClient): PrismaClient {
  return {
    $transaction: async <T>(
      callback: (tx: DbTransaction) => Promise<T>,
    ): Promise<T> =>
      runtime.$transaction(async (tx) => {
        const auditLog = new Proxy(tx.auditLog, {
          get(target, property, receiver) {
            if (property === "create") {
              return async () => {
                throw new Error("forced audit failure");
              };
            }
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const wrapped = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === "auditLog") return auditLog;
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as DbTransaction;
        return callback(wrapped);
      }),
  } as unknown as PrismaClient;
}

describe("DS-013/DS-014 reconciliation case commands", () => {
  const suffix = Date.now().toString(36);
  const tenantIds: string[] = [];
  let app: INestApplication;
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let service: ReconciliationCaseService;
  let tenantId: string;
  let tenantCode: string;
  let operatorAId: string;
  let operatorBId: string;
  let noPermissionId: string;
  let financeToken: string;
  let financeBToken: string;
  let noPermissionToken: string;
  let httpCaseId: string;

  async function createCase(
    status: "OPEN" | "CLAIMED" = "OPEN",
    ownerId?: string,
  ) {
    const caseId = randomUUID();
    await owner.reconciliationDifference.create({
      data: {
        tenantId,
        kind: "AMOUNT_MISMATCH",
        amountFen: 120n,
        case: {
          create: {
            id: caseId,
            tenantId,
            status,
            ...(ownerId === undefined ? {} : { ownerId }),
          },
        },
      },
    });
    return caseId;
  }

  async function login(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "tenant", tenantCode, username, password: PASSWORD })
      .expect(201);
    return (response.body as { data: { accessToken: string } }).data
      .accessToken;
  }

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    service = new ReconciliationCaseService(
      new PrismaReconciliationCaseRepository(runtime),
    );

    tenantCode = `ds013_${suffix}`;
    const tenant = await owner.tenant.create({
      data: { code: tenantCode, name: "DS-013 验收店" },
    });
    tenantId = tenant.id;
    tenantIds.push(tenantId);
    const passwordHash = await hashPassword(PASSWORD);
    const [operatorA, operatorB, noPermission] = await Promise.all([
      owner.tenantAccount.create({
        data: { tenantId, username: "finance-a", passwordHash },
      }),
      owner.tenantAccount.create({
        data: { tenantId, username: "finance-b", passwordHash },
      }),
      owner.tenantAccount.create({
        data: { tenantId, username: "admin-no-finance", passwordHash },
      }),
    ]);
    operatorAId = operatorA.id;
    operatorBId = operatorB.id;
    noPermissionId = noPermission.id;
    await owner.tenantAccountRole.createMany({
      data: [
        { tenantId, tenantAccountId: operatorAId, role: "FINANCE" },
        { tenantId, tenantAccountId: operatorBId, role: "FINANCE" },
        {
          tenantId,
          tenantAccountId: noPermissionId,
          role: "TENANT_ADMIN",
        },
      ],
    });
    httpCaseId = await createCase();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    financeToken = await login("finance-a");
    financeBToken = await login("finance-b");
    noPermissionToken = await login("admin-no-finance");
  });

  afterAll(async () => {
    if (app) await app.close();
    if (owner) {
      const allTenants = { in: tenantIds };
      await owner.auditLog.deleteMany({ where: { tenantId: allTenants } });
      await owner.refreshSession.deleteMany({
        where: { tenantId: allTenants },
      });
      await owner.reconciliationCase.deleteMany({
        where: { tenantId: allTenants },
      });
      await owner.reconciliationDifference.deleteMany({
        where: { tenantId: allTenants },
      });
      await owner.ledgerTransaction.deleteMany({
        where: { tenantId: allTenants },
      });
      await owner.tenantAccountRole.deleteMany({ where: { tenantId } });
      await owner.tenantAccount.deleteMany({ where: { tenantId } });
      await owner.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("HTTP 命令要求认证与 finance.manage，并以 200 返回推进后的处理单", async () => {
    const path = `/api/v1/tenant/reconciliation/cases/${httpCaseId}/claim`;
    await request(app.getHttpServer())
      .post(path)
      .send({ expectedVersion: 1 })
      .expect(401);
    await request(app.getHttpServer())
      .post(path)
      .set("authorization", `Bearer ${noPermissionToken}`)
      .send({ expectedVersion: 1 })
      .expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set("authorization", `Bearer ${financeToken}`)
      .send({ expectedVersion: "1" })
      .expect(400);

    const claimed = await request(app.getHttpServer())
      .post(path)
      .set("authorization", `Bearer ${financeToken}`)
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(claimed.body.data).toMatchObject({
      id: httpCaseId,
      status: "CLAIMED",
      ownerId: operatorAId,
      version: 2,
    });

    await request(app.getHttpServer())
      .post(path)
      .set("authorization", `Bearer ${financeToken}`)
      .send({ expectedVersion: 1 })
      .expect(200);

    const started = await request(app.getHttpServer())
      .post(
        `/api/v1/tenant/reconciliation/cases/${httpCaseId}/start-processing`,
      )
      .set("authorization", `Bearer ${financeToken}`)
      .send({ expectedVersion: 2 })
      .expect(200);
    expect(started.body.data).toMatchObject({
      id: httpCaseId,
      status: "PROCESSING",
      ownerId: operatorAId,
      version: 3,
    });

    await request(app.getHttpServer())
      .post(
        `/api/v1/tenant/reconciliation/cases/${httpCaseId}/start-processing`,
      )
      .set("authorization", `Bearer ${financeToken}`)
      .send({ expectedVersion: 2 })
      .expect(200);

    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/tenant/reconciliation/cases/${httpCaseId}/submit-review`)
      .set("authorization", `Bearer ${financeToken}`)
      .send({
        expectedVersion: 3,
        resolutionType: "NO_LEDGER_CHANGE",
        resolutionNote: "渠道记录与本地账目一致，无需改账",
      })
      .expect(200);
    expect(submitted.body.data).toMatchObject({
      id: httpCaseId,
      status: "PENDING_REVIEW",
      ownerId: operatorAId,
      resolutionType: "NO_LEDGER_CHANGE",
      linkedTransactionId: null,
      reviewedBy: null,
      version: 4,
      difference: { resolvedAt: null },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/tenant/reconciliation/cases/${httpCaseId}/submit-review`)
      .set("authorization", `Bearer ${financeToken}`)
      .send({
        expectedVersion: 3,
        resolutionType: "NO_LEDGER_CHANGE",
        resolutionNote: "渠道记录与本地账目一致，无需改账",
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/tenant/reconciliation/cases/${httpCaseId}/close`)
      .set("authorization", `Bearer ${financeToken}`)
      .send({ expectedVersion: 4 })
      .expect(409);

    const closed = await request(app.getHttpServer())
      .post(`/api/v1/tenant/reconciliation/cases/${httpCaseId}/close`)
      .set("authorization", `Bearer ${financeBToken}`)
      .send({ expectedVersion: 4 })
      .expect(200);
    expect(closed.body.data).toMatchObject({
      id: httpCaseId,
      status: "CLOSED",
      ownerId: operatorAId,
      reviewedBy: operatorBId,
      version: 5,
    });
    expect(closed.body.data.reviewedAt).toBe(closed.body.data.closedAt);
    expect(closed.body.data.closedAt).toBe(
      closed.body.data.difference.resolvedAt,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/tenant/reconciliation/cases/${httpCaseId}/close`)
      .set("authorization", `Bearer ${financeBToken}`)
      .send({ expectedVersion: 4 })
      .expect(200);

    const audits = await owner.auditLog.findMany({
      where: { tenantId, resourceId: httpCaseId },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((row) => [row.action, row.actorId])).toEqual([
      ["payment.reconciliation_case.claimed", operatorAId],
      ["payment.reconciliation_case.processing_started", operatorAId],
      ["payment.reconciliation_case.review_submitted", operatorAId],
      ["payment.reconciliation_case.closed", operatorBId],
    ]);
  });

  it("OPEN 处理单可带理由忽略，精确重试不重复审计并同步解析差异", async () => {
    const caseId = await createCase();
    const path = `/api/v1/tenant/reconciliation/cases/${caseId}/ignore`;
    const body = { expectedVersion: 1, reason: "渠道重复行，无需改账" };

    const ignored = await request(app.getHttpServer())
      .post(path)
      .set("authorization", `Bearer ${financeToken}`)
      .send(body)
      .expect(200);
    expect(ignored.body.data).toMatchObject({
      status: "IGNORED",
      resolutionType: "IGNORED",
      resolutionNote: body.reason,
      linkedTransactionId: null,
      reviewedBy: null,
      reviewedAt: null,
      version: 2,
    });
    expect(ignored.body.data.closedAt).toBe(
      ignored.body.data.difference.resolvedAt,
    );

    const replay = await request(app.getHttpServer())
      .post(path)
      .set("authorization", `Bearer ${financeToken}`)
      .send(body)
      .expect(200);
    expect(replay.body.data).toEqual(ignored.body.data);
    expect(
      await owner.auditLog.count({
        where: {
          tenantId,
          resourceId: caseId,
          action: "payment.reconciliation_case.ignored",
        },
      }),
    ).toBe(1);
  });

  it("两个财务并发认领时恰好一个获胜且只写一条审计", async () => {
    const caseId = await createCase();
    const results = await Promise.allSettled([
      service.claim({
        tenantId,
        operatorAccountId: operatorAId,
        caseId,
        body: { expectedVersion: 1 },
      }),
      service.claim({
        tenantId,
        operatorAccountId: operatorBId,
        caseId,
        body: { expectedVersion: 1 },
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(Error);
    }

    const row = await owner.reconciliationCase.findUniqueOrThrow({
      where: { id: caseId },
    });
    expect(row.status).toBe("CLAIMED");
    expect([operatorAId, operatorBId]).toContain(row.ownerId);
    expect(row.version).toBe(2);
    const audits = await owner.auditLog.findMany({
      where: {
        tenantId,
        resourceId: caseId,
        action: "payment.reconciliation_case.claimed",
      },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(row.ownerId);
  });

  it("非处理人和陈旧版本都被拒绝且不写审计", async () => {
    const caseId = await createCase("CLAIMED", operatorAId);

    await expect(
      service.startProcessing({
        tenantId,
        operatorAccountId: operatorBId,
        caseId,
        body: { expectedVersion: 1 },
      }),
    ).rejects.toBeInstanceOf(ReconciliationCaseConflictError);
    await expect(
      service.startProcessing({
        tenantId,
        operatorAccountId: operatorAId,
        caseId,
        body: { expectedVersion: 2 },
      }),
    ).rejects.toBeInstanceOf(ReconciliationCaseConflictError);

    expect(
      await owner.auditLog.count({ where: { tenantId, resourceId: caseId } }),
    ).toBe(0);
    expect(
      await owner.reconciliationCase.findUniqueOrThrow({
        where: { id: caseId },
      }),
    ).toMatchObject({ status: "CLAIMED", ownerId: operatorAId, version: 1 });
  });

  it("审计写入失败时状态、处理人和版本全部回滚", async () => {
    const caseId = await createCase();
    const failingService = new ReconciliationCaseService(
      new PrismaReconciliationCaseRepository(auditFailingRuntime(runtime)),
    );

    await expect(
      failingService.claim({
        tenantId,
        operatorAccountId: operatorAId,
        caseId,
        body: { expectedVersion: 1 },
      }),
    ).rejects.toThrow("forced audit failure");

    expect(
      await owner.reconciliationCase.findUniqueOrThrow({
        where: { id: caseId },
      }),
    ).toMatchObject({ status: "OPEN", ownerId: null, version: 1 });
    expect(
      await owner.auditLog.count({ where: { tenantId, resourceId: caseId } }),
    ).toBe(0);
  });

  it("提交复核只接受本租户 CONFIRMED 交易，拒绝后状态与审计不变", async () => {
    const caseId = randomUUID();
    await owner.reconciliationDifference.create({
      data: {
        tenantId,
        kind: "STATUS_MISMATCH",
        case: {
          create: {
            id: caseId,
            tenantId,
            status: "PROCESSING",
            ownerId: operatorAId,
          },
        },
      },
    });
    const draft = await owner.ledgerTransaction.create({
      data: {
        tenantId,
        txNo: `DS014_DRAFT_${suffix}`,
        status: "DRAFT",
        description: "DS-014 不可关联草稿交易",
      },
    });

    await expect(
      service.submitReview({
        tenantId,
        operatorAccountId: operatorAId,
        caseId,
        body: {
          expectedVersion: 1,
          resolutionType: "LEDGER_TRANSACTION",
          resolutionNote: "尝试关联草稿交易",
          linkedTransactionId: draft.id,
        },
      }),
    ).rejects.toBeInstanceOf(ReconciliationCaseInputError);
    expect(
      await owner.reconciliationCase.findUniqueOrThrow({
        where: { id: caseId },
      }),
    ).toMatchObject({
      status: "PROCESSING",
      version: 1,
      resolutionType: null,
      linkedTransactionId: null,
    });
    expect(
      await owner.auditLog.count({ where: { tenantId, resourceId: caseId } }),
    ).toBe(0);
  });

  it("关闭时审计失败会回滚终态、复核字段和差异解析时间", async () => {
    const caseId = randomUUID();
    const difference = await owner.reconciliationDifference.create({
      data: {
        tenantId,
        kind: "AMOUNT_MISMATCH",
        case: {
          create: {
            id: caseId,
            tenantId,
            status: "PENDING_REVIEW",
            ownerId: operatorAId,
            resolutionType: "NO_LEDGER_CHANGE",
            resolutionNote: "已核对，无需改账",
          },
        },
      },
    });
    const failingService = new ReconciliationCaseService(
      new PrismaReconciliationCaseRepository(auditFailingRuntime(runtime)),
    );

    await expect(
      failingService.close({
        tenantId,
        operatorAccountId: operatorBId,
        caseId,
        body: { expectedVersion: 1 },
      }),
    ).rejects.toThrow("forced audit failure");
    expect(
      await owner.reconciliationCase.findUniqueOrThrow({
        where: { id: caseId },
      }),
    ).toMatchObject({
      status: "PENDING_REVIEW",
      reviewedBy: null,
      reviewedAt: null,
      closedAt: null,
      version: 1,
    });
    expect(
      await owner.reconciliationDifference.findUniqueOrThrow({
        where: { id: difference.id },
      }),
    ).toMatchObject({ resolvedAt: null });
    expect(
      await owner.auditLog.count({ where: { tenantId, resourceId: caseId } }),
    ).toBe(0);
  });

  it("差异已提前解析时关闭整笔回滚且不伪造成功审计", async () => {
    const caseId = randomUUID();
    const resolvedAt = new Date("2026-09-24T00:00:00.000Z");
    const difference = await owner.reconciliationDifference.create({
      data: {
        tenantId,
        kind: "AMOUNT_MISMATCH",
        resolvedAt,
        case: {
          create: {
            id: caseId,
            tenantId,
            status: "PENDING_REVIEW",
            ownerId: operatorAId,
            resolutionType: "NO_LEDGER_CHANGE",
            resolutionNote: "已核对，无需改账",
          },
        },
      },
    });

    await expect(
      service.close({
        tenantId,
        operatorAccountId: operatorBId,
        caseId,
        body: { expectedVersion: 1 },
      }),
    ).rejects.toThrow("对账差异解析失败");
    expect(
      await owner.reconciliationCase.findUniqueOrThrow({
        where: { id: caseId },
      }),
    ).toMatchObject({
      status: "PENDING_REVIEW",
      reviewedBy: null,
      reviewedAt: null,
      closedAt: null,
      version: 1,
    });
    expect(
      await owner.reconciliationDifference.findUniqueOrThrow({
        where: { id: difference.id },
      }),
    ).toMatchObject({ resolvedAt });
    expect(
      await owner.auditLog.count({ where: { tenantId, resourceId: caseId } }),
    ).toBe(0);
  });

  it("本租户看不到的处理单使用稳定的 not-found 错误", async () => {
    const otherTenant = await owner.tenant.create({
      data: { code: `ds013_other_${suffix}`, name: "DS-013 其他店" },
    });
    tenantIds.push(otherTenant.id);
    const caseId = randomUUID();
    await owner.reconciliationDifference.create({
      data: {
        tenantId: otherTenant.id,
        kind: "MISSING_LOCAL",
        case: { create: { id: caseId, tenantId: otherTenant.id } },
      },
    });

    await expect(
      service.claim({
        tenantId,
        operatorAccountId: operatorAId,
        caseId,
        body: { expectedVersion: 1 },
      }),
    ).rejects.toBeInstanceOf(ReconciliationCaseNotFoundError);
    expect(
      await owner.reconciliationCase.findUniqueOrThrow({
        where: { id: caseId },
      }),
    ).toMatchObject({ status: "OPEN", ownerId: null, version: 1 });
    expect(await owner.auditLog.count({ where: { resourceId: caseId } })).toBe(
      0,
    );
  });
});
