import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { FundLedgerService } from "../../apps/api/src/modules/ledger/application/fund-ledger.service.js";
import { FundLedgerExportLimitError } from "../../apps/api/src/modules/ledger/application/fund-ledger-ports.js";

const PASSWORD = "Fund-Ledger-Password-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

interface LoginResponse {
  data: { accessToken?: string };
}

interface FundLedgerRowResponse {
  transactionId: string;
  txNo: string;
  eventType: string | null;
  status: string;
  reconciliationStatus: string;
  sourceType: string | null;
  sourceId: string | null;
  description: string | null;
  amountFen: string;
  debitFen: string;
  creditFen: string;
  balanced: boolean;
  fundFlowDirection: "DEBIT" | "CREDIT" | "MIXED" | null;
  fundAccount: {
    id: string;
    code: string;
    name: string;
    kind: string;
    status: string;
  } | null;
  auxiliaries: Array<{ type: string; id: string }>;
  createdBy: string | null;
  confirmedBy: string | null;
  occurredAt: string;
  confirmedAt: string | null;
  createdAt: string;
}

interface FundLedgerResponse {
  data: {
    rows: FundLedgerRowResponse[];
    total: number;
    page: number;
    pageSize: number;
    sortBy: string;
    sortDir: string;
  };
}

describe("DS-007 / DS-008 unified fund ledger query and CSV export", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let foreignTenantId = "";
  let ownerToken = "";
  let customerToken = "";
  let foreignOwnerToken = "";
  let fundAccountId = "";
  let foreignFundAccountId = "";
  let ownerId = "";
  let ledgerService: FundLedgerService;
  const transactionIds: Record<string, string> = {};

  async function createTenantAccount(
    targetTenantId: string,
    username: string,
    role: "TENANT_OWNER" | "CUSTOMER",
    passwordHash: string,
  ): Promise<string> {
    const account = await client.tenantAccount.create({
      data: { tenantId: targetTenantId, username, passwordHash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId: targetTenantId, tenantAccountId: account.id, role },
    });
    return account.id;
  }

  async function login(tenantCode: string, username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        kind: "tenant",
        tenantCode,
        username,
        password: PASSWORD,
      })
      .expect(201);
    return (response.body as LoginResponse).data.accessToken as string;
  }

  async function createLedgerTransaction(input: {
    tenantId: string;
    label: string;
    eventType:
      | "PAYMENT_CONFIRMED"
      | "REFUND_CONFIRMED"
      | "PLAYER_PAYOUT_CONFIRMED"
      | "RECONCILIATION_ADJUSTMENT";
    status?: "CONFIRMED" | "RECONCILED";
    sourceType: string;
    sourceId: string;
    occurredAt: string;
    debitFen: bigint;
    creditFen: bigint;
    fundAccountId: string;
    fundDirection: "DEBIT" | "CREDIT";
    debitAccountId: string;
    creditAccountId: string;
    auxiliaryType: string;
    auxiliaryId: string;
    actorId: string;
  }): Promise<string> {
    const transaction = await client.ledgerTransaction.create({
      data: {
        tenantId: input.tenantId,
        txNo: `FLT_${input.label}_${suffix}`,
        description: `fund ledger ${input.label}`,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        eventType: input.eventType,
        status: input.status ?? "CONFIRMED",
        fundAccountId: input.fundAccountId,
        createdBy: input.actorId,
        confirmedBy: input.actorId,
        occurredAt: new Date(input.occurredAt),
        confirmedAt: new Date(input.occurredAt),
      },
    });
    await client.ledgerEntry.createMany({
      data: [
        {
          tenantId: input.tenantId,
          transactionId: transaction.id,
          accountId: input.debitAccountId,
          direction: "DEBIT",
          amountFen: input.debitFen,
          fundAccountId:
            input.fundDirection === "DEBIT" ? input.fundAccountId : null,
          auxiliaryType: input.auxiliaryType,
          auxiliaryId: input.auxiliaryId,
        },
        {
          tenantId: input.tenantId,
          transactionId: transaction.id,
          accountId: input.creditAccountId,
          direction: "CREDIT",
          amountFen: input.creditFen,
          fundAccountId:
            input.fundDirection === "CREDIT" ? input.fundAccountId : null,
          auxiliaryType: input.auxiliaryType,
          auxiliaryId: input.auxiliaryId,
        },
      ],
    });
    return transaction.id;
  }

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const passwordHash = await hashPassword(PASSWORD);
    const tenant = await client.tenant.create({
      data: { code: `fund_ledger_${suffix}`, name: "资金台账测试店" },
    });
    const foreignTenant = await client.tenant.create({
      data: { code: `fund_ledger_foreign_${suffix}`, name: "其他资金测试店" },
    });
    tenantId = tenant.id;
    foreignTenantId = foreignTenant.id;
    ownerId = await createTenantAccount(
      tenantId,
      `owner_${suffix}`,
      "TENANT_OWNER",
      passwordHash,
    );
    await createTenantAccount(
      tenantId,
      `customer_${suffix}`,
      "CUSTOMER",
      passwordHash,
    );
    const foreignOwnerId = await createTenantAccount(
      foreignTenantId,
      `foreign_owner_${suffix}`,
      "TENANT_OWNER",
      passwordHash,
    );

    const fundAccount = await client.fundAccount.create({
      data: {
        tenantId,
        code: `BANK_MAIN_${suffix}`,
        name: "主结算银行账户",
        kind: "BANK",
        externalRef: "SENSITIVE-ACCOUNT-REF",
      },
    });
    fundAccountId = fundAccount.id;
    const foreignFundAccount = await client.fundAccount.create({
      data: {
        tenantId: foreignTenantId,
        code: `FOREIGN_BANK_${suffix}`,
        name: "其他租户银行账户",
        kind: "BANK",
      },
    });
    foreignFundAccountId = foreignFundAccount.id;

    const debitAccount = await client.ledgerAccount.create({
      data: { tenantId, code: `DEBIT_${suffix}`, name: "测试借方" },
    });
    const creditAccount = await client.ledgerAccount.create({
      data: { tenantId, code: `CREDIT_${suffix}`, name: "测试贷方" },
    });
    const foreignDebitAccount = await client.ledgerAccount.create({
      data: {
        tenantId: foreignTenantId,
        code: `FOREIGN_DEBIT_${suffix}`,
        name: "其他租户借方",
      },
    });
    const foreignCreditAccount = await client.ledgerAccount.create({
      data: {
        tenantId: foreignTenantId,
        code: `FOREIGN_CREDIT_${suffix}`,
        name: "其他租户贷方",
      },
    });

    const customerAuxiliaryId = randomUUID();
    transactionIds.payment = await createLedgerTransaction({
      tenantId,
      label: "payment",
      eventType: "PAYMENT_CONFIRMED",
      sourceType: "payment_order",
      sourceId: randomUUID(),
      occurredAt: "2026-09-20T10:00:00.000Z",
      debitFen: 9007199254740993n,
      creditFen: 9007199254740993n,
      fundAccountId,
      fundDirection: "DEBIT",
      debitAccountId: debitAccount.id,
      creditAccountId: creditAccount.id,
      auxiliaryType: "customer_profile",
      auxiliaryId: customerAuxiliaryId,
      actorId: ownerId,
    });
    transactionIds.refund = await createLedgerTransaction({
      tenantId,
      label: "refund",
      eventType: "REFUND_CONFIRMED",
      status: "RECONCILED",
      sourceType: "payment_refund",
      sourceId: randomUUID(),
      occurredAt: "2026-09-21T10:00:00.000Z",
      debitFen: 250n,
      creditFen: 250n,
      fundAccountId,
      fundDirection: "CREDIT",
      debitAccountId: debitAccount.id,
      creditAccountId: creditAccount.id,
      auxiliaryType: "customer_profile",
      auxiliaryId: customerAuxiliaryId,
      actorId: ownerId,
    });
    transactionIds.payout = await createLedgerTransaction({
      tenantId,
      label: "payout",
      eventType: "PLAYER_PAYOUT_CONFIRMED",
      sourceType: "settlement_batch",
      sourceId: randomUUID(),
      occurredAt: "2026-09-22T10:00:00.000Z",
      debitFen: 700n,
      creditFen: 700n,
      fundAccountId,
      fundDirection: "CREDIT",
      debitAccountId: debitAccount.id,
      creditAccountId: creditAccount.id,
      auxiliaryType: "settlement_batch",
      auxiliaryId: randomUUID(),
      actorId: ownerId,
    });
    transactionIds.unbalanced = await createLedgerTransaction({
      tenantId,
      label: "unbalanced",
      eventType: "RECONCILIATION_ADJUSTMENT",
      sourceType: "reconciliation_case",
      sourceId: randomUUID(),
      occurredAt: "2026-09-23T10:00:00.000Z",
      debitFen: 900n,
      creditFen: 800n,
      fundAccountId,
      fundDirection: "DEBIT",
      debitAccountId: debitAccount.id,
      creditAccountId: creditAccount.id,
      auxiliaryType: "reconciliation_case",
      auxiliaryId: randomUUID(),
      actorId: ownerId,
    });
    transactionIds.foreign = await createLedgerTransaction({
      tenantId: foreignTenantId,
      label: "foreign",
      eventType: "PAYMENT_CONFIRMED",
      sourceType: "payment_order",
      sourceId: randomUUID(),
      occurredAt: "2026-09-24T10:00:00.000Z",
      debitFen: 1234n,
      creditFen: 1234n,
      fundAccountId: foreignFundAccountId,
      fundDirection: "DEBIT",
      debitAccountId: foreignDebitAccount.id,
      creditAccountId: foreignCreditAccount.id,
      auxiliaryType: "customer_profile",
      auxiliaryId: randomUUID(),
      actorId: foreignOwnerId,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    ledgerService = app.get(FundLedgerService);
    ownerToken = await login(tenant.code, `owner_${suffix}`);
    customerToken = await login(tenant.code, `customer_${suffix}`);
    foreignOwnerToken = await login(
      foreignTenant.code,
      `foreign_owner_${suffix}`,
    );
  });

  afterAll(async () => {
    if (client) {
      for (const targetTenantId of [tenantId, foreignTenantId]) {
        await client.auditLog.deleteMany({
          where: { tenantId: targetTenantId },
        });
        await client.ledgerEntry.deleteMany({
          where: { tenantId: targetTenantId },
        });
        await client.ledgerTransaction.deleteMany({
          where: { tenantId: targetTenantId },
        });
        await client.ledgerAccount.deleteMany({
          where: { tenantId: targetTenantId },
        });
        await client.fundAccount.deleteMany({
          where: { tenantId: targetTenantId },
        });
        const accounts = await client.tenantAccount.findMany({
          where: { tenantId: targetTenantId },
          select: { id: true },
        });
        await client.refreshSession.deleteMany({
          where: { accountId: { in: accounts.map((account) => account.id) } },
        });
        await client.tenantAccountRole.deleteMany({
          where: { tenantId: targetTenantId },
        });
        await client.tenantAccount.deleteMany({
          where: { tenantId: targetTenantId },
        });
        await client.tenant.deleteMany({ where: { id: targetTenantId } });
      }
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function getLedger(token: string, query = "") {
    return request(app.getHttpServer())
      .get(`/api/v1/tenant/funds/ledger${query}`)
      .set("authorization", `Bearer ${token}`);
  }

  function exportLedger(token: string, query = "") {
    return request(app.getHttpServer())
      .get(`/api/v1/tenant/funds/ledger/export.csv${query}`)
      .set("authorization", `Bearer ${token}`);
  }

  it("returns all three confirmed fund events with exact BigInt and anomaly semantics", async () => {
    const beforeAuditCount = await client.auditLog.count({
      where: { tenantId },
    });
    const beforeTransactionCount = await client.ledgerTransaction.count({
      where: { tenantId },
    });

    const response = await getLedger(ownerToken).expect(200);
    const body = response.body as FundLedgerResponse;
    expect(body.data.total).toBe(4);
    expect(body.data.page).toBe(1);
    expect(body.data.pageSize).toBe(50);
    expect(body.data.sortBy).toBe("occurredAt");
    expect(body.data.sortDir).toBe("desc");
    expect(body.data.rows.map((row) => row.eventType).sort()).toEqual([
      "PAYMENT_CONFIRMED",
      "PLAYER_PAYOUT_CONFIRMED",
      "RECONCILIATION_ADJUSTMENT",
      "REFUND_CONFIRMED",
    ]);
    expect(
      body.data.rows.some(
        (row) => row.transactionId === transactionIds.foreign,
      ),
    ).toBe(false);

    const payment = body.data.rows.find(
      (row) => row.transactionId === transactionIds.payment,
    );
    expect(payment).toMatchObject({
      amountFen: "9007199254740993",
      debitFen: "9007199254740993",
      creditFen: "9007199254740993",
      balanced: true,
      fundFlowDirection: "DEBIT",
      reconciliationStatus: "UNRECONCILED",
    });
    expect(payment?.fundAccount).toMatchObject({
      id: fundAccountId,
      kind: "BANK",
      status: "ACTIVE",
    });
    expect(JSON.stringify(payment)).not.toContain("SENSITIVE-ACCOUNT-REF");

    const refund = body.data.rows.find(
      (row) => row.transactionId === transactionIds.refund,
    );
    expect(refund).toMatchObject({
      amountFen: "250",
      balanced: true,
      fundFlowDirection: "CREDIT",
      status: "RECONCILED",
      reconciliationStatus: "RECONCILED",
    });
    expect(refund?.auxiliaries).toHaveLength(1);
    expect(refund?.auxiliaries[0]?.type).toBe("customer_profile");

    const payout = body.data.rows.find(
      (row) => row.transactionId === transactionIds.payout,
    );
    expect(payout).toMatchObject({
      amountFen: "700",
      balanced: true,
      fundFlowDirection: "CREDIT",
      sourceType: "settlement_batch",
    });
    expect(payout?.auxiliaries[0]?.type).toBe("settlement_batch");

    const anomaly = body.data.rows.find(
      (row) => row.transactionId === transactionIds.unbalanced,
    );
    expect(anomaly).toMatchObject({
      amountFen: "900",
      debitFen: "900",
      creditFen: "800",
      balanced: false,
    });

    expect(await client.auditLog.count({ where: { tenantId } })).toBe(
      beforeAuditCount,
    );
    expect(await client.ledgerTransaction.count({ where: { tenantId } })).toBe(
      beforeTransactionCount,
    );
  });

  it("applies event, status, account, source, keyword, date and amount filters", async () => {
    const eventResponse = await getLedger(
      ownerToken,
      "?eventType=REFUND_CONFIRMED",
    ).expect(200);
    expect((eventResponse.body as FundLedgerResponse).data.rows).toHaveLength(
      1,
    );
    expect(
      (eventResponse.body as FundLedgerResponse).data.rows[0]?.transactionId,
    ).toBe(transactionIds.refund);

    const statusResponse = await getLedger(
      ownerToken,
      "?status=RECONCILED",
    ).expect(200);
    expect(
      (statusResponse.body as FundLedgerResponse).data.rows[0]?.transactionId,
    ).toBe(transactionIds.refund);

    const accountResponse = await getLedger(
      ownerToken,
      `?fundAccountId=${fundAccountId}`,
    ).expect(200);
    expect((accountResponse.body as FundLedgerResponse).data.total).toBe(4);

    const sourceResponse = await getLedger(
      ownerToken,
      "?sourceType=settlement_batch",
    ).expect(200);
    expect(
      (sourceResponse.body as FundLedgerResponse).data.rows[0]?.transactionId,
    ).toBe(transactionIds.payout);

    const keywordResponse = await getLedger(
      ownerToken,
      `?q=${encodeURIComponent(`BANK_MAIN_${suffix}`)}`,
    ).expect(200);
    expect((keywordResponse.body as FundLedgerResponse).data.total).toBe(4);

    const dateResponse = await getLedger(
      ownerToken,
      "?occurredFrom=2026-09-21T00%3A00%3A00.000Z&occurredTo=2026-09-23T00%3A00%3A00.000Z",
    ).expect(200);
    expect(
      (dateResponse.body as FundLedgerResponse).data.rows
        .map((row) => row.transactionId)
        .sort(),
    ).toEqual([transactionIds.payout, transactionIds.refund].sort());

    const amountResponse = await getLedger(
      ownerToken,
      "?minAmountFen=700&maxAmountFen=700",
    ).expect(200);
    expect(
      (amountResponse.body as FundLedgerResponse).data.rows[0]?.transactionId,
    ).toBe(transactionIds.payout);

    const aboveInt8Response = await getLedger(
      ownerToken,
      "?minAmountFen=9223372036854775808",
    ).expect(200);
    expect((aboveInt8Response.body as FundLedgerResponse).data.rows).toEqual(
      [],
    );
  });

  it("uses database sorting and stable transaction-level pagination", async () => {
    const firstPage = await getLedger(
      ownerToken,
      "?sortBy=amountFen&sortDir=asc&page=1&pageSize=2",
    ).expect(200);
    const secondPage = await getLedger(
      ownerToken,
      "?sortBy=amountFen&sortDir=asc&page=2&pageSize=2",
    ).expect(200);
    const firstBody = firstPage.body as FundLedgerResponse;
    const secondBody = secondPage.body as FundLedgerResponse;
    expect(firstBody.data.rows.map((row) => row.amountFen)).toEqual([
      "250",
      "700",
    ]);
    expect(secondBody.data.rows.map((row) => row.amountFen)).toEqual([
      "900",
      "9007199254740993",
    ]);
    expect(firstBody.data.total).toBe(4);
    expect(secondBody.data.total).toBe(4);
    expect(
      new Set(
        [...firstBody.data.rows, ...secondBody.data.rows].map(
          (row) => row.transactionId,
        ),
      ).size,
    ).toBe(4);

    const emptyPage = await getLedger(
      ownerToken,
      "?sortBy=amountFen&sortDir=asc&page=999&pageSize=2",
    ).expect(200);
    expect((emptyPage.body as FundLedgerResponse).data.rows).toEqual([]);
    expect((emptyPage.body as FundLedgerResponse).data.total).toBe(4);
  });

  it("rejects invalid filters and enforces finance permission", async () => {
    await getLedger(ownerToken, "?fundAccountId=").expect(400);
    await getLedger(ownerToken, "?pageSize=201").expect(400);
    await getLedger(ownerToken, "?occurredFrom=not-a-time").expect(400);
    await getLedger(customerToken).expect(403);
  });

  it("keeps tenant totals and rows isolated", async () => {
    const own = await getLedger(ownerToken).expect(200);
    const foreign = await getLedger(foreignOwnerToken).expect(200);
    const ownBody = own.body as FundLedgerResponse;
    const foreignBody = foreign.body as FundLedgerResponse;
    expect(ownBody.data.total).toBe(4);
    expect(foreignBody.data.total).toBe(1);
    expect(foreignBody.data.rows[0]?.transactionId).toBe(
      transactionIds.foreign,
    );
    expect(
      foreignBody.data.rows.some((row) =>
        Object.values(transactionIds).slice(0, 4).includes(row.transactionId),
      ),
    ).toBe(false);
  });

  it("exports filtered and sorted CSV with fixed headers, exact BigInt and anomaly semantics", async () => {
    const beforeAuditCount = await client.auditLog.count({
      where: { tenantId },
    });
    const beforeTransactionCount = await client.ledgerTransaction.count({
      where: { tenantId },
    });

    const response = await exportLedger(
      ownerToken,
      "?minAmountFen=700&sortBy=amountFen&sortDir=asc",
    ).expect(200);

    expect(response.headers["content-type"]).toContain(
      "text/csv; charset=utf-8",
    );
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="fund-ledger.csv"',
    );
    expect(response.text.startsWith("\uFEFF交易号,事件类型")).toBe(true);
    expect(response.text.endsWith("\r\n")).toBe(true);
    expect(response.text).toContain("90071992547409.93");
    expect(response.text).toContain("RECONCILIATION_ADJUSTMENT");
    expect(response.text).toContain(",否,");
    expect(response.text.indexOf("7.00")).toBeLessThan(
      response.text.indexOf("9.00"),
    );
    expect(response.text.indexOf("9.00")).toBeLessThan(
      response.text.indexOf("90071992547409.93"),
    );
    expect(response.text).not.toContain("SENSITIVE-ACCOUNT-REF");
    expect(response.text).not.toContain(transactionIds.foreign);

    expect(await client.auditLog.count({ where: { tenantId } })).toBe(
      beforeAuditCount,
    );
    expect(await client.ledgerTransaction.count({ where: { tenantId } })).toBe(
      beforeTransactionCount,
    );
  });

  it("keeps CSV exports tenant-isolated and enforces finance permission", async () => {
    const own = await exportLedger(ownerToken).expect(200);
    const foreign = await exportLedger(foreignOwnerToken).expect(200);

    expect(own.text).toContain(`FLT_payment_${suffix}`);
    expect(own.text).not.toContain(`FLT_foreign_${suffix}`);
    expect(foreign.text).toContain(`FLT_foreign_${suffix}`);
    expect(foreign.text).not.toContain(`FLT_payment_${suffix}`);
    await exportLedger(customerToken).expect(403);
  });

  it("maps invalid export filters to 400 and export overflow to 422", async () => {
    const invalidResponse = await exportLedger(
      ownerToken,
      "?occurredFrom=not-a-time",
    ).expect(400);
    expect(invalidResponse.headers["content-type"]).toContain(
      "application/json",
    );

    const exportSpy = vi
      .spyOn(ledgerService, "exportCsv")
      .mockRejectedValueOnce(
        new FundLedgerExportLimitError("导出结果超过 5000 行，请缩小筛选范围"),
      );
    const response = await exportLedger(ownerToken).expect(422);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toMatchObject({
      type: "about:blank#http-error",
      title: "Error",
      status: 422,
      code: "FundLedgerExportLimitError",
      message: "导出结果超过 5000 行，请缩小筛选范围",
    });
    expect(response.body.requestId).toEqual(expect.any(String));
    exportSpy.mockRestore();
  });
});
