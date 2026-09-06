import { describe, expect, it } from "vitest";
import { parseFenString } from "../../apps/api/src/common/money.js";
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
