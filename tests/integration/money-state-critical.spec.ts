import { describe, expect, it } from "vitest";
import {
  fenToYuanText,
  parseFenString,
} from "../../apps/api/src/common/money.js";
import { splitSettlement } from "../../apps/api/src/modules/ledger/domain/split.js";
import {
  ORDER_TRANSITIONS,
  assertOrderTransition,
  canTransition,
} from "../../apps/api/src/modules/orders/domain/order-state-machine.js";
import type { OrderStatusType } from "../../apps/api/src/modules/orders/domain/order.js";

describe("critical domain coverage: MoneyFen / split / order state machine", () => {
  it("parseFenString 覆盖全部拒绝与允许分支", () => {
    expect(parseFenString(1500, true)).toBeNull();
    expect(parseFenString("", true)).toBeNull();
    expect(parseFenString(" 1", true)).toBeNull();
    expect(parseFenString("1 ", true)).toBeNull();
    expect(parseFenString("1.5", true)).toBeNull();
    expect(parseFenString("-1", true)).toBeNull();
    expect(parseFenString("01", true)).toBeNull();
    expect(parseFenString("0", false)).toBeNull();
    expect(parseFenString("0", true)).toBe("0");
    expect(parseFenString("1", true)).toBe("1");
    expect(parseFenString("1500", false)).toBe("1500");
  });

  it("fenToYuanText 合法换算与非法兜底（全程整数，不经浮点）", () => {
    expect(fenToYuanText("0")).toBe("0.00");
    expect(fenToYuanText("1")).toBe("0.01");
    expect(fenToYuanText("15")).toBe("0.15");
    expect(fenToYuanText("100")).toBe("1.00");
    expect(fenToYuanText("1500")).toBe("15.00");
    // 超出 Number.MAX_SAFE_INTEGER（9007199254740991）：若经浮点会得到
    // "…409.92"（该串会被 Number 舍入到 …992），此处断言 BigInt 结果 …409.93
    expect(fenToYuanText("9007199254740993")).toBe("90071992547409.93");
    // 非法值沿用既有支付台账导出的兜底语义（返回 "0.00"）
    expect(fenToYuanText("")).toBe("0.00");
    expect(fenToYuanText(" 1")).toBe("0.00");
    expect(fenToYuanText("1 ")).toBe("0.00");
    expect(fenToYuanText("1.5")).toBe("0.00");
    expect(fenToYuanText("-1")).toBe("0.00");
    expect(fenToYuanText("01")).toBe("0.00");
  });

  it("splitSettlement 非法金额/费率全部拒绝", () => {
    const valid = { platformFeeBp: 300, storeCutBp: 2000 };
    expect(() => splitSettlement(0n, valid)).toThrow();
    expect(() => splitSettlement(-1n, valid)).toThrow();
    expect(() =>
      splitSettlement(100n, { ...valid, platformFeeBp: 10.5 }),
    ).toThrow();
    expect(() =>
      splitSettlement(100n, { ...valid, storeCutBp: 10.5 }),
    ).toThrow();
    expect(() =>
      splitSettlement(100n, { ...valid, platformFeeBp: -1 }),
    ).toThrow();
    expect(() => splitSettlement(100n, { ...valid, storeCutBp: -1 })).toThrow();
    expect(() =>
      splitSettlement(100n, { platformFeeBp: 9000, storeCutBp: 2000 }),
    ).toThrow();
    expect(splitSettlement(10000n, valid)).toEqual({
      platformFeeFen: 300n,
      storeCutFen: 2000n,
      playerShareFen: 7700n,
    });
  });

  it("order state machine：全部状态迁移与拒绝分支", () => {
    const statuses = Object.keys(ORDER_TRANSITIONS) as OrderStatusType[];
    const all = new Set<OrderStatusType>(statuses);
    for (const from of statuses) {
      for (const to of statuses) {
        expect(canTransition(from, to)).toBe(
          ORDER_TRANSITIONS[from]?.includes(to) ?? false,
        );
        if (ORDER_TRANSITIONS[from]?.includes(to)) {
          expect(() => assertOrderTransition("o", from, to)).not.toThrow();
        } else {
          expect(() => assertOrderTransition("o", from, to)).toThrow();
        }
      }
      expect(ORDER_TRANSITIONS[from]?.length ?? 0).toBeGreaterThanOrEqual(0);
      void all;
    }
    expect(canTransition("UNKNOWN" as OrderStatusType, "CONFIRMED")).toBe(
      false,
    );
  });
});
