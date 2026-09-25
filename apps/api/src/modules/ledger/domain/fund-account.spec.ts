import { describe, expect, it } from "vitest";
import {
  FUND_ACCOUNT_KINDS,
  FundAccountInputError,
  normalizeCreateFundAccountInput,
  toFundAccountView,
} from "./fund-account.js";
import type { FundAccountRecord } from "./fund-account.js";

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: "WECHAT_MAIN",
    name: "微信结算主账户",
    kind: "WECHAT_SETTLEMENT",
    ...overrides,
  };
}

describe("资金账户领域规则（DS-002 规范化与校验）", () => {
  it("四种 kind 全部接受", () => {
    for (const kind of FUND_ACCOUNT_KINDS) {
      expect(normalizeCreateFundAccountInput(valid({ kind })).kind, kind).toBe(kind);
    }
  });

  it("code 规范化：trim 后转大写", () => {
    expect(normalizeCreateFundAccountInput(valid({ code: "  bank_a1  " })).code).toBe("BANK_A1");
    expect(normalizeCreateFundAccountInput(valid({ code: "A1" })).code).toBe("A1");
  });

  it("非法 code 抛 FundAccountInputError，不静默截断", () => {
    for (const code of ["9ABC", "A1!", "A", "", "  ", "_A", "A-B", "啊".repeat(3), "A".repeat(33)]) {
      expect(() => normalizeCreateFundAccountInput(valid({ code })), `code=${code}`).toThrow(
        FundAccountInputError,
      );
    }
    expect(() => normalizeCreateFundAccountInput(valid({ code: 123 }))).toThrow(
      FundAccountInputError,
    );
  });

  it("name 去空白后长度需为 1-64", () => {
    expect(normalizeCreateFundAccountInput(valid({ name: "  现金账户  " })).name).toBe("现金账户");
    expect(normalizeCreateFundAccountInput(valid({ name: "啊".repeat(64) })).name.length).toBe(64);
    expect(() => normalizeCreateFundAccountInput(valid({ name: "   " }))).toThrow(
      FundAccountInputError,
    );
    expect(() => normalizeCreateFundAccountInput(valid({ name: "啊".repeat(65) }))).toThrow(
      FundAccountInputError,
    );
    expect(() => normalizeCreateFundAccountInput(valid({ name: 42 }))).toThrow(
      FundAccountInputError,
    );
  });

  it("kind 必须是四个枚举字符串之一，不精确匹配即拒绝", () => {
    for (const kind of ["bank", "Bank", "  BANK", "UNKNOWN", "", null, 1, undefined]) {
      expect(
        () => normalizeCreateFundAccountInput(valid({ kind })),
        `kind=${String(kind)}`,
      ).toThrow(FundAccountInputError);
    }
  });

  it("externalRef 未传或空白归为 null，非空时 trim", () => {
    expect(normalizeCreateFundAccountInput(valid({ kind: "CASH" })).externalRef).toBeNull();
    expect(
      normalizeCreateFundAccountInput(valid({ kind: "CASH", externalRef: "   " })).externalRef,
    ).toBeNull();
    expect(
      normalizeCreateFundAccountInput(valid({ kind: "CASH", externalRef: "  现金抽屉#1  " }))
        .externalRef,
    ).toBe("现金抽屉#1");
  });

  it("externalRef 非空时长度需为 1-64", () => {
    expect(
      normalizeCreateFundAccountInput(valid({ kind: "OFFLINE", externalRef: "x".repeat(64) }))
        .externalRef,
    ).toHaveLength(64);
    expect(() =>
      normalizeCreateFundAccountInput(valid({ kind: "OFFLINE", externalRef: "x".repeat(65) })),
    ).toThrow(FundAccountInputError);
    expect(() =>
      normalizeCreateFundAccountInput(valid({ kind: "OFFLINE", externalRef: 42 })),
    ).toThrow(FundAccountInputError);
  });

  it("BANK 传入 externalRef 时必须包含 *，防止存完整卡号", () => {
    expect(
      normalizeCreateFundAccountInput(valid({ kind: "BANK", externalRef: "6222****1234" }))
        .externalRef,
    ).toBe("6222****1234");
    expect(() =>
      normalizeCreateFundAccountInput(valid({ kind: "BANK", externalRef: "6222021234567890" })),
    ).toThrow(FundAccountInputError);
  });

  it("BANK 未传 externalRef 允许，不触发卡号规则", () => {
    expect(normalizeCreateFundAccountInput(valid({ kind: "BANK" })).externalRef).toBeNull();
    expect(
      normalizeCreateFundAccountInput(valid({ kind: "BANK", externalRef: "  " })).externalRef,
    ).toBeNull();
  });

  it("非对象请求体被拒绝", () => {
    for (const body of [null, undefined, "x", 42, true]) {
      expect(() => normalizeCreateFundAccountInput(body), String(body)).toThrow(
        FundAccountInputError,
      );
    }
  });

  it("toFundAccountView 把 createdAt 转成 ISO 字符串且不泄露 tenantId", () => {
    const record: FundAccountRecord = {
      id: "acc-1",
      tenantId: "tenant-1",
      code: "WECHAT_MAIN",
      name: "微信结算主账户",
      kind: "WECHAT_SETTLEMENT",
      status: "ACTIVE",
      externalRef: null,
      createdAt: new Date("2026-09-24T00:00:00.000Z"),
    };
    const view = toFundAccountView(record);
    expect(view.createdAt).toBe("2026-09-24T00:00:00.000Z");
    expect(new Date(view.createdAt).toISOString()).toBe(view.createdAt);
    expect(view.status).toBe("ACTIVE");
    expect(view).not.toHaveProperty("tenantId");
    expect(view).not.toHaveProperty("balance");
  });
});
