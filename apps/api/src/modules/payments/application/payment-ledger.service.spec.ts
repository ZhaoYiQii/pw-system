import { describe, expect, it } from "vitest";
import type {
  PaymentLedgerQuery,
  PaymentLedgerRepository,
  PaymentLedgerRow,
} from "./payment-ledger-ports.js";
import {
  PAYMENT_LEDGER_DEFAULT_LIMIT,
  PAYMENT_LEDGER_MAX_LIMIT,
  parseLedgerLimit,
  parseLedgerStatus,
  TenantPaymentLedgerService,
  toLedgerRowView,
} from "./payment-ledger.service.js";
import { PaymentLedgerInputError } from "../domain/payments.errors.js";

/**
 * S4-7：门店支付台账的**纯口径**单测（真库/RLS 行为见 integration 用例）。
 *
 * 两条不可退让的口径：
 * 1. 筛选状态认不出就报错——把 "REFUNDED" 这种不存在的状态当"全部"会让门店以为筛选生效了；
 * 2. `canRefund` 与人工退款登记同一判据（已支付 + 还有可退余额），避免台账说能退、后端 409。
 */

function row(overrides: Partial<PaymentLedgerRow> = {}): PaymentLedgerRow {
  return {
    id: "order-1",
    outNo: "RCHMUBTRXCT07973E2F",
    amountFen: 12800n,
    refundedFen: 0n,
    status: "SUCCESS",
    customerProfileId: "customer-1",
    customerName: "老王",
    createdAt: new Date("2026-09-23T03:38:13.827Z"),
    paidAt: new Date("2026-09-23T03:38:14.000Z"),
    ...overrides,
  };
}

function repositoryStub(rows: PaymentLedgerRow[]) {
  const calls: PaymentLedgerQuery[] = [];
  const repository: PaymentLedgerRepository = {
    listOrders: async (query) => {
      calls.push(query);
      return rows;
    },
  };
  return { repository, calls };
}

describe("parseLedgerStatus", () => {
  it("未传或空串 = 不过滤", () => {
    expect(parseLedgerStatus(undefined)).toBeNull();
    expect(parseLedgerStatus("")).toBeNull();
    expect(parseLedgerStatus("   ")).toBeNull();
  });

  it("只认 payment_orders 的三个真实状态", () => {
    expect(parseLedgerStatus("SUCCESS")).toBe("SUCCESS");
    expect(parseLedgerStatus("PENDING")).toBe("PENDING");
    expect(parseLedgerStatus("FAILED")).toBe("FAILED");
  });

  it("认不出的状态报 400 而不是静默当全部", () => {
    for (const bad of ["REFUNDED", "success", "ALL", "1"]) {
      expect(() => parseLedgerStatus(bad)).toThrow(PaymentLedgerInputError);
    }
  });
});

describe("parseLedgerLimit", () => {
  it("默认 50，上限 200", () => {
    expect(parseLedgerLimit(undefined)).toBe(PAYMENT_LEDGER_DEFAULT_LIMIT);
    expect(parseLedgerLimit("10")).toBe(10);
    expect(parseLedgerLimit(String(PAYMENT_LEDGER_MAX_LIMIT))).toBe(
      PAYMENT_LEDGER_MAX_LIMIT,
    );
  });

  it("越界与非整数一律 400（不静默夹到上限）", () => {
    for (const bad of ["0", "-1", "201", "abc", "1.5", "1e2"]) {
      expect(() => parseLedgerLimit(bad)).toThrow(PaymentLedgerInputError);
    }
  });
});

describe("toLedgerRowView", () => {
  it("金额是十进制字符串分，可退 = 支付 - 已退", () => {
    const view = toLedgerRowView(
      row({ amountFen: 12800n, refundedFen: 2800n }),
    );
    expect(view.amountFen).toBe("12800");
    expect(view.refundedFen).toBe("2800");
    expect(view.refundableFen).toBe("10000");
    expect(view.canRefund).toBe(true);
    expect(view.createdAt).toBe("2026-09-23T03:38:13.827Z");
    expect(view.paidAt).toBe("2026-09-23T03:38:14.000Z");
  });

  it("未支付的单不给退款入口", () => {
    const view = toLedgerRowView(row({ status: "PENDING", paidAt: null }));
    expect(view.canRefund).toBe(false);
    expect(view.paidAt).toBeNull();
  });

  it("全额退过 → 可退 0、canRefund=false（支付单状态仍是 SUCCESS）", () => {
    const view = toLedgerRowView(
      row({ amountFen: 12800n, refundedFen: 12800n }),
    );
    expect(view.status).toBe("SUCCESS");
    expect(view.refundableFen).toBe("0");
    expect(view.canRefund).toBe(false);
  });

  it("退款额超过支付额（脏数据）时不会出现负数可退", () => {
    const view = toLedgerRowView(row({ amountFen: 100n, refundedFen: 300n }));
    expect(view.refundableFen).toBe("0");
    expect(view.canRefund).toBe(false);
  });
});

describe("TenantPaymentLedgerService.list", () => {
  it("把租户与过滤条件原样传给仓储，并回显生效的 limit/status", async () => {
    const { repository, calls } = repositoryStub([row()]);
    const service = new TenantPaymentLedgerService(repository);

    const view = await service.list({
      tenantId: "tenant-1",
      status: "SUCCESS",
      limit: "5",
    });

    expect(calls).toEqual([
      { tenantId: "tenant-1", status: "SUCCESS", limit: 5 },
    ]);
    expect(view.limit).toBe(5);
    expect(view.status).toBe("SUCCESS");
    expect(view.rows).toHaveLength(1);
  });

  it("不传过滤时不带 status 字段（仓储层不拼无效条件）", async () => {
    const { repository, calls } = repositoryStub([]);
    const service = new TenantPaymentLedgerService(repository);

    const view = await service.list({ tenantId: "tenant-1" });

    expect(calls).toEqual([
      { tenantId: "tenant-1", limit: PAYMENT_LEDGER_DEFAULT_LIMIT },
    ]);
    expect(view.status).toBeNull();
    expect(view.rows).toEqual([]);
  });
});
