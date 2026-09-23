import { describe, expect, it } from "vitest";
import type {
  PaymentLedgerQuery,
  PaymentLedgerRepository,
  PaymentLedgerRow,
} from "./payment-ledger-ports.js";
import {
  fenToYuanText,
  parseLedgerLimit,
  parseLedgerPage,
  parseLedgerQuery,
  parseLedgerSearch,
  parseLedgerSort,
  parseLedgerStatus,
  PAYMENT_LEDGER_DEFAULT_LIMIT,
  PAYMENT_LEDGER_EXPORT_MAX_ROWS,
  PAYMENT_LEDGER_MAX_LIMIT,
  TenantPaymentLedgerService,
  toLedgerCsv,
  toLedgerRowView,
} from "./payment-ledger.service.js";
import { PaymentLedgerInputError } from "../domain/payments.errors.js";

/**
 * S5-1：门店支付台账的**纯口径**单测（真库/RLS 行为见 integration 用例）。
 *
 * 三条不可退让的口径：
 * 1. 筛选/排序/page/pageSize 认不出就报错——静默忽略会让表格显示的数据与用户意图不符；
 * 2. `canRefund` 与人工退款登记同一判据（已支付 + 还有可退余额）；
 * 3. 导出按**整数运算**转元、CSV 正确转义（客户名里的逗号不能把列冲散）。
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

function repositoryStub(rows: PaymentLedgerRow[], total?: number) {
  const calls: Array<Record<string, unknown>> = [];
  const repository: PaymentLedgerRepository = {
    listOrders: async (query: PaymentLedgerQuery) => {
      calls.push({ kind: "list", ...query });
      return rows;
    },
    countOrders: async (query) => {
      calls.push({ kind: "count", ...query });
      return total ?? rows.length;
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

describe("parseLedgerLimit / parseLedgerPage", () => {
  it("默认 50，上限 200", () => {
    expect(parseLedgerLimit(undefined)).toBe(PAYMENT_LEDGER_DEFAULT_LIMIT);
    expect(parseLedgerLimit("10")).toBe(10);
    expect(parseLedgerLimit(String(PAYMENT_LEDGER_MAX_LIMIT))).toBe(
      PAYMENT_LEDGER_MAX_LIMIT,
    );
  });

  it("limit 越界与非整数一律 400（不静默夹到上限）", () => {
    for (const bad of ["0", "-1", "201", "abc", "1.5", "1e2"]) {
      expect(() => parseLedgerLimit(bad)).toThrow(PaymentLedgerInputError);
    }
  });

  it("page 默认 1，且不接受 0 / 负数 / 小数", () => {
    expect(parseLedgerPage(undefined)).toBe(1);
    expect(parseLedgerPage("3")).toBe(3);
    for (const bad of ["0", "-1", "1.5", "abc"]) {
      expect(() => parseLedgerPage(bad)).toThrow(PaymentLedgerInputError);
    }
  });
});

describe("parseLedgerSort", () => {
  it("默认按创建时间倒序（台账先看最近的）", () => {
    expect(parseLedgerSort(undefined, undefined)).toEqual({
      sortBy: "createdAt",
      sortDir: "desc",
    });
  });

  it("白名单内的字段与方向可用", () => {
    expect(parseLedgerSort("amountFen", "asc")).toEqual({
      sortBy: "amountFen",
      sortDir: "asc",
    });
  });

  it("白名单外的排序字段报 400（关系列如 customerName 不在本片范围）", () => {
    for (const bad of ["customerName", "refundedFen", "amount_fen", "1"]) {
      expect(() => parseLedgerSort(bad, "desc")).toThrow(
        PaymentLedgerInputError,
      );
    }
  });

  it("方向只认 asc / desc", () => {
    expect(() => parseLedgerSort("createdAt", "up")).toThrow(
      PaymentLedgerInputError,
    );
  });
});

describe("parseLedgerSearch", () => {
  it("空串不过滤，正常串去空格", () => {
    expect(parseLedgerSearch(undefined)).toBeNull();
    expect(parseLedgerSearch("  ")).toBeNull();
    expect(parseLedgerSearch(" 走查 ")).toBe("走查");
  });

  it("超长关键词 400（不静默截断）", () => {
    expect(() => parseLedgerSearch("x".repeat(51))).toThrow(
      PaymentLedgerInputError,
    );
  });
});

describe("parseLedgerQuery", () => {
  it("把一组原始参数收成一个仓储查询（旧 limit 参数等价 pageSize）", () => {
    const query = parseLedgerQuery({
      tenantId: "tenant-1",
      status: "SUCCESS",
      q: " 老王 ",
      sortBy: "amountFen",
      sortDir: "asc",
      page: "2",
      limit: "10",
    });
    expect(query).toEqual({
      tenantId: "tenant-1",
      status: "SUCCESS",
      q: "老王",
      sortBy: "amountFen",
      sortDir: "asc",
      page: 2,
      pageSize: 10,
    });
  });

  it("pageSize 优先于 limit；都不传时用默认", () => {
    expect(
      parseLedgerQuery({ tenantId: "t", pageSize: "7", limit: "9" }).pageSize,
    ).toBe(7);
    expect(parseLedgerQuery({ tenantId: "t" }).pageSize).toBe(
      PAYMENT_LEDGER_DEFAULT_LIMIT,
    );
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

describe("fenToYuanText / toLedgerCsv", () => {
  it("分转元是整数运算（不经过浮点）", () => {
    expect(fenToYuanText("0")).toBe("0.00");
    expect(fenToYuanText("5")).toBe("0.05");
    expect(fenToYuanText("100")).toBe("1.00");
    expect(fenToYuanText("199900")).toBe("1999.00");
    expect(fenToYuanText("abc")).toBe("0.00");
  });

  it("CSV 带 BOM、表头中文、金额按元，且客户名里的逗号不会冲散列", () => {
    const csv = toLedgerCsv([
      toLedgerRowView(row({ customerName: "老王, 大客户" })),
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    // BOM 属于首行开头，比较表头前先剥掉（Excel 需要 BOM 才不乱码）
    const [header, first] = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(header).toBe(
      "支付单号,客户,状态,支付金额(元),已退(元),可退(元),创建时间,支付时间",
    );
    expect(first).toContain('"老王, 大客户"');
    expect(first).toContain("128.00");
  });

  it("引号会被翻倍转义", () => {
    const csv = toLedgerCsv([toLedgerRowView(row({ customerName: 'A"B' }))]);
    expect(csv).toContain('"A""B"');
  });
});

describe("TenantPaymentLedgerService", () => {
  it("list 同时取当页与总数，并回显生效的分页/排序/筛选", async () => {
    const { repository, calls } = repositoryStub([row()], 42);
    const service = new TenantPaymentLedgerService(repository);

    const view = await service.list({
      tenantId: "tenant-1",
      status: "SUCCESS",
      q: "老王",
      sortBy: "amountFen",
      sortDir: "asc",
      page: "2",
      pageSize: "5",
    });

    expect(calls).toEqual([
      {
        kind: "list",
        tenantId: "tenant-1",
        status: "SUCCESS",
        q: "老王",
        sortBy: "amountFen",
        sortDir: "asc",
        page: 2,
        pageSize: 5,
      },
      { kind: "count", tenantId: "tenant-1", status: "SUCCESS", q: "老王" },
    ]);
    expect(view.total).toBe(42);
    expect(view.page).toBe(2);
    expect(view.pageSize).toBe(5);
    expect(view.sortBy).toBe("amountFen");
    expect(view.rows).toHaveLength(1);
  });

  it("不传筛选时不带 status/q 字段（仓储层不拼无效条件）", async () => {
    const { repository, calls } = repositoryStub([]);
    const service = new TenantPaymentLedgerService(repository);

    const view = await service.list({ tenantId: "tenant-1" });

    expect(calls).toEqual([
      {
        kind: "list",
        tenantId: "tenant-1",
        sortBy: "createdAt",
        sortDir: "desc",
        page: 1,
        pageSize: PAYMENT_LEDGER_DEFAULT_LIMIT,
      },
      { kind: "count", tenantId: "tenant-1" },
    ]);
    expect(view.status).toBeNull();
    expect(view.q).toBeNull();
    expect(view.rows).toEqual([]);
  });

  it("导出走独立的行数上限（不受 pageSize 200 的限制）且排序固定为最近优先", async () => {
    const { repository, calls } = repositoryStub([row()], 1);
    const service = new TenantPaymentLedgerService(repository);

    const csv = await service.exportCsv({
      tenantId: "tenant-1",
      status: "SUCCESS",
    });

    expect(calls[0]).toEqual({
      kind: "list",
      tenantId: "tenant-1",
      status: "SUCCESS",
      sortBy: "createdAt",
      sortDir: "desc",
      page: 1,
      pageSize: PAYMENT_LEDGER_EXPORT_MAX_ROWS,
    });
    expect(csv).toContain("支付单号,客户,状态");
  });

  it("导出参数非法同样 400", async () => {
    const { repository } = repositoryStub([]);
    const service = new TenantPaymentLedgerService(repository);

    await expect(
      service.exportCsv({ tenantId: "tenant-1", status: "REFUNDED" }),
    ).rejects.toBeInstanceOf(PaymentLedgerInputError);
  });
});
