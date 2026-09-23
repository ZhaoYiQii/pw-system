import { describe, expect, it } from "vitest";
import type {
  TenantWalletRepository,
  TenantWalletRow,
  WalletEntryRow,
} from "./tenant-wallet-ports.js";
import {
  parseWalletQuery,
  TenantWalletService,
  toWalletEntryView,
  WALLET_ENTRY_LIMIT_DEFAULT,
  WALLET_QUERY_MAX_LENGTH,
  walletEntryTypeLabel,
} from "./tenant-wallet.service.js";
import {
  PaymentLedgerInputError,
  PaymentWalletNotFoundError,
} from "../domain/payments.errors.js";

/**
 * S4-9a：门店客户钱包台账的纯口径单测。
 *
 * 两条红线：
 * 1. **方向不许猜**：认不出的流水类型 direction=null（把出账显示成入账比不显示更危险）；
 * 2. 没有钱包的客户 → 404 且文案说清楚"还没充过值"，而不是返回余额 0 让人以为钱包是空的。
 */

function walletRow(overrides: Partial<TenantWalletRow> = {}): TenantWalletRow {
  return {
    walletId: "wallet-1",
    bossNo: "BMUBTRXCR9083EE",
    customerProfileId: "profile-1",
    customerName: "走查老板",
    balanceFen: 199900n,
    entryCount: 3,
    lastEntryAt: new Date("2026-09-23T06:20:59.941Z"),
    ...overrides,
  };
}

function entryRow(overrides: Partial<WalletEntryRow> = {}): WalletEntryRow {
  return {
    id: "entry-1",
    txNo: "MR152BB7AA7D43753B6ECD98F9",
    type: "REFUND",
    amountFen: 100n,
    balanceAfterFen: 199900n,
    reason: "人工退款登记：S4-7a 走查",
    referenceType: "payment_refund",
    referenceId: "refund-1",
    createdAt: new Date("2026-09-23T06:20:59.941Z"),
    ...overrides,
  };
}

function repositoryStub(options: {
  wallets?: TenantWalletRow[];
  detail?: {
    walletId: string;
    bossNo: string;
    customerProfileId: string;
    customerName: string | null;
    balanceFen: bigint;
    entries: WalletEntryRow[];
  } | null;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const repository: TenantWalletRepository = {
    listWallets: async (query) => {
      calls.push({ kind: "list", ...query });
      return options.wallets ?? [];
    },
    findWalletDetail: async (input) => {
      calls.push({ kind: "detail", ...input });
      return options.detail ?? null;
    },
  };
  return { repository, calls };
}

describe("walletEntryTypeLabel / 方向", () => {
  it("三个真实类型有中文说明与方向", () => {
    expect(walletEntryTypeLabel("RECHARGE")).toContain("充值");
    expect(toWalletEntryView(entryRow({ type: "RECHARGE" })).direction).toBe(
      "IN",
    );
    expect(toWalletEntryView(entryRow({ type: "REFUND" })).direction).toBe(
      "OUT",
    );
    expect(toWalletEntryView(entryRow({ type: "DEDUCT" })).direction).toBe(
      "OUT",
    );
  });

  it("认不出的类型：原样点名 + 不给方向（不猜正负）", () => {
    const view = toWalletEntryView(entryRow({ type: "SOMETHING_NEW" }));
    expect(view.typeLabel).toBe("未识别类型：SOMETHING_NEW");
    expect(view.direction).toBeNull();
    expect(view.amountFen).toBe("100");
  });
});

describe("parseWalletQuery", () => {
  it("空串 = 不过滤；正常串去空格", () => {
    expect(parseWalletQuery(undefined)).toBeNull();
    expect(parseWalletQuery("   ")).toBeNull();
    expect(parseWalletQuery("  老王 ")).toBe("老王");
  });

  it("超长查询串 400（不静默截断）", () => {
    expect(() =>
      parseWalletQuery("x".repeat(WALLET_QUERY_MAX_LENGTH + 1)),
    ).toThrow(PaymentLedgerInputError);
  });
});

describe("TenantWalletService.listWallets", () => {
  it("把租户/搜索/limit 传下去，并回显生效值", async () => {
    const { repository, calls } = repositoryStub({ wallets: [walletRow()] });
    const service = new TenantWalletService(repository);

    const view = await service.listWallets({
      tenantId: "tenant-1",
      query: " 走查 ",
      limit: "10",
    });

    expect(calls).toEqual([
      { kind: "list", tenantId: "tenant-1", query: "走查", limit: 10 },
    ]);
    expect(view.query).toBe("走查");
    expect(view.limit).toBe(10);
    expect(view.rows[0]?.balanceFen).toBe("199900");
  });

  it("不传搜索时不带 query 字段", async () => {
    const { repository, calls } = repositoryStub({});
    const service = new TenantWalletService(repository);

    const view = await service.listWallets({ tenantId: "tenant-1" });

    expect(calls).toEqual([{ kind: "list", tenantId: "tenant-1", limit: 50 }]);
    expect(view.query).toBeNull();
  });

  it("limit 越界直接 400（与支付台账同一校验）", async () => {
    const { repository } = repositoryStub({});
    const service = new TenantWalletService(repository);

    await expect(
      service.listWallets({ tenantId: "tenant-1", limit: "999" }),
    ).rejects.toBeInstanceOf(PaymentLedgerInputError);
  });
});

describe("TenantWalletService.getWalletDetail", () => {
  it("有钱包：返回余额 + 流水（含方向与中文类型）", async () => {
    const { repository, calls } = repositoryStub({
      detail: {
        walletId: "wallet-1",
        bossNo: "BMUBTRXCR9083EE",
        customerProfileId: "profile-1",
        customerName: "走查老板",
        balanceFen: 199900n,
        entries: [entryRow()],
      },
    });
    const service = new TenantWalletService(repository);

    const view = await service.getWalletDetail({
      tenantId: "tenant-1",
      customerProfileId: "profile-1",
    });

    expect(calls).toEqual([
      {
        kind: "detail",
        tenantId: "tenant-1",
        customerProfileId: "profile-1",
        entryLimit: WALLET_ENTRY_LIMIT_DEFAULT,
      },
    ]);
    expect(view.balanceFen).toBe("199900");
    expect(view.entries[0]?.typeLabel).toBe("退款出账");
    expect(view.entries[0]?.direction).toBe("OUT");
  });

  it("没有钱包 → 404 且说明原因", async () => {
    const { repository } = repositoryStub({ detail: null });
    const service = new TenantWalletService(repository);

    await expect(
      service.getWalletDetail({
        tenantId: "tenant-1",
        customerProfileId: "profile-x",
      }),
    ).rejects.toBeInstanceOf(PaymentWalletNotFoundError);
  });
});
