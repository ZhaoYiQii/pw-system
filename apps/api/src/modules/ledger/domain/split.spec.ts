import { describe, expect, it } from "vitest";
import { splitSettlement } from "./split.js";

describe("ledger split (金额不变量/舍入/bigint)", () => {
  it("默认 3%/20%：总和=金额，陪玩≈77%（含尾差）", () => {
    const r = splitSettlement(10000n, { platformFeeBp: 300, storeCutBp: 2000 });
    expect(r.platformFeeFen + r.storeCutFen + r.playerShareFen).toBe(10000n);
    expect(r.platformFeeFen).toBe(300n);
    expect(r.storeCutFen).toBe(2000n);
    expect(r.playerShareFen).toBe(7700n);
  });

  it("尾差归陪玩（1 分场景）", () => {
    const r = splitSettlement(1n, { platformFeeBp: 300, storeCutBp: 2000 });
    expect(r.platformFeeFen).toBe(0n);
    expect(r.storeCutFen).toBe(0n);
    expect(r.playerShareFen).toBe(1n);
  });

  it("超大金额不溢出，守恒仍成立", () => {
    const amount = 2n ** 90n;
    const r = splitSettlement(amount, { platformFeeBp: 300, storeCutBp: 2000 });
    expect(r.platformFeeFen + r.storeCutFen + r.playerShareFen).toBe(amount);
  });

  it("非法输入/费率被拒", () => {
    expect(() => splitSettlement(-1n, { platformFeeBp: 300, storeCutBp: 2000 })).toThrow();
    expect(() => splitSettlement(100n, { platformFeeBp: 6000, storeCutBp: 6000 })).toThrow();
    expect(() => splitSettlement(100n, { platformFeeBp: 10.5, storeCutBp: 2000 })).toThrow();
  });
});