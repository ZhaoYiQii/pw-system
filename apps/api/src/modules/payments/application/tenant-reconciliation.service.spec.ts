import { describe, expect, it } from "vitest";
import type {
  ReconciliationDifferenceRow,
  ReconciliationStatementRow,
  TenantReconciliationRepository,
} from "./tenant-reconciliation-ports.js";
import {
  RECONCILIATION_STATEMENT_LIMIT,
  differenceKindLabel,
  TenantReconciliationService,
  toDifferenceView,
  toStatementView,
} from "./tenant-reconciliation.service.js";
import { PaymentLedgerInputError } from "../domain/payments.errors.js";

/**
 * S4-7b：门店可见对账的纯口径单测。
 *
 * 关键两条：
 * 1. **认不出的差异类型必须原样透出**（`未识别差异类型：X`）——差异悄悄消失比差异本身更危险；
 * 2. **未解决总数来自单独 count**，不能被列表 limit 截断（否则门店会以为只剩两条差异）。
 */

const STATEMENT: ReconciliationStatementRow = {
  id: "stmt-1",
  billType: "TRADE",
  billDate: new Date("2026-09-22T00:00:00.000Z"),
  subMchid: "1900013511",
  totalCount: 3,
  totalFen: 30000n,
  downloadedAt: new Date("2026-09-23T01:00:00.000Z"),
};

const DIFFERENCE: ReconciliationDifferenceRow = {
  id: "diff-1",
  kind: "AMOUNT_MISMATCH",
  amountFen: 100n,
  detail: "微信 100 分，本地 0 分",
  paymentOrderId: "order-1",
  resolvedAt: null,
  createdAt: new Date("2026-09-23T01:01:00.000Z"),
};

function repositoryStub(options: {
  statements?: ReconciliationStatementRow[];
  differences?: ReconciliationDifferenceRow[];
  unresolvedCount?: number;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const repository: TenantReconciliationRepository = {
    listStatements: async (input) => {
      calls.push({ kind: "statements", ...input });
      return options.statements ?? [];
    },
    listDifferences: async (input) => {
      calls.push({ kind: "differences", ...input });
      return options.differences ?? [];
    },
    countUnresolvedDifferences: async (tenantId) => {
      calls.push({ kind: "count", tenantId });
      return options.unresolvedCount ?? 0;
    },
  };
  return { repository, calls };
}

describe("differenceKindLabel", () => {
  it("四个已知类型都有中文说明", () => {
    expect(differenceKindLabel("MISSING_LOCAL")).toContain("漏记");
    expect(differenceKindLabel("MISSING_WECHAT")).toContain("多记");
    expect(differenceKindLabel("AMOUNT_MISMATCH")).toBe("金额不一致");
    expect(differenceKindLabel("STATUS_MISMATCH")).toBe("状态不一致");
  });

  it("认不出的类型原样点名，不静默归类", () => {
    expect(differenceKindLabel("NEW_KIND_FROM_WECHAT")).toBe(
      "未识别差异类型：NEW_KIND_FROM_WECHAT",
    );
  });
});

describe("视图映射", () => {
  it("账单日期是 YYYY-MM-DD，金额是字符串分", () => {
    const view = toStatementView(STATEMENT);
    expect(view.billDate).toBe("2026-09-22");
    expect(view.totalFen).toBe("30000");
    expect(view.downloadedAt).toBe("2026-09-23T01:00:00.000Z");
  });

  it("差异金额可以为空（状态类差异没有金额）", () => {
    expect(toDifferenceView(DIFFERENCE).amountFen).toBe("100");
    const noAmount = toDifferenceView({ ...DIFFERENCE, amountFen: null });
    expect(noAmount.amountFen).toBeNull();
    expect(noAmount.resolvedAt).toBeNull();
  });
});

describe("TenantReconciliationService.overview", () => {
  it("账单固定取最近 5 份；差异用传入 limit；未解决数是单独 count", async () => {
    const { repository, calls } = repositoryStub({
      statements: [STATEMENT],
      differences: [DIFFERENCE],
      unresolvedCount: 7,
    });
    const service = new TenantReconciliationService(repository);

    const view = await service.overview({ tenantId: "tenant-1", limit: "3" });

    expect(calls).toEqual([
      {
        kind: "statements",
        tenantId: "tenant-1",
        limit: RECONCILIATION_STATEMENT_LIMIT,
      },
      { kind: "differences", tenantId: "tenant-1", limit: 3 },
      { kind: "count", tenantId: "tenant-1" },
    ]);
    expect(view.unresolvedCount).toBe(7);
    expect(view.differences).toHaveLength(1);
  });

  it("limit 越界直接 400（与支付台账同一口径）", async () => {
    const { repository } = repositoryStub({});
    const service = new TenantReconciliationService(repository);

    await expect(
      service.overview({ tenantId: "tenant-1", limit: "0" }),
    ).rejects.toBeInstanceOf(PaymentLedgerInputError);
  });

  it("没有账单也没有差异时返回空壳（门店看到的是'账目一致'而不是报错）", async () => {
    const { repository } = repositoryStub({});
    const service = new TenantReconciliationService(repository);

    const view = await service.overview({ tenantId: "tenant-1" });

    expect(view).toEqual({
      statements: [],
      differences: [],
      unresolvedCount: 0,
    });
  });
});
