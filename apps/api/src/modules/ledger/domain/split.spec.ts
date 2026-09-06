import { describe, expect, it } from "vitest";
import { splitSettlement } from "./split.js";

describe("ledger split (金额不变量/舍入)", () => {
  it("默认 3%/20%：总和=金额，陪玩≈77%（含尾差）", () => {
    const r = splitSettlement(10000, { platformFeeBp: 300, storeCutBp: 2000 });
    expect(r.platformFeeFen + r.storeCutFen + r.playerShareFen).toBe(10000);
    expect(r.platformFeeFen).toBe(300);
    expect(r.storeCutFen).toBe(2000);
    expect(r.playerShareFen).toBe(7700);
  });

  it("不平衡会由陪玩尾差兜底（如 1 分）", () => {
    const r = splitSettlement(1, { platformFeeBp: 300, storeCutBp: 2000 });
    expect(r.platformFeeFen).toBe(0);
    expect(r.storeCutFen).toBe(0);
    expect(r.playerShareFen).toBe(1);
  });

  it("非法输入/费率被拒", () => {
    expect(() => splitSettlement(-1, { platformFeeBp: 300, storeCutBp: 2000 })).toThrow();
    expect(() => splitSettlement(100, { platformFeeBp: 6000, storeCutBp: 6000 })).toThrow();
    expect(() => splitSettlement(100, { platformFeeBp: 10.5, storeCutBp: 2000 })).toThrow();
  });
});