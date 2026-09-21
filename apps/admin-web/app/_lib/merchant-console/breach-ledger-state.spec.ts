/**
 * P3 / D3：违约台账筛选/分页纯函数单测。
 */
import { describe, expect, it } from "vitest";
import {
  BREACH_PAGE_SIZE,
  buildBreachLedgerQuery,
  dayEndIso,
  dayStartIso,
  normalizeBreachLimit,
} from "./breach-ledger-state.js";

describe("P3 / D3：违约台账筛选参数", () => {
  it("日期按「含当天」的本地区间转换", () => {
    const start = dayStartIso("2026-09-20");
    const end = dayEndIso("2026-09-20");
    expect(start).toBe(new Date("2026-09-20T00:00:00").toISOString());
    expect(end).toBe(new Date("2026-09-20T23:59:59.999").toISOString());
  });

  it("非法或空日期不产生参数", () => {
    expect(dayStartIso("")).toBeNull();
    expect(dayStartIso("2026/09/20")).toBeNull();
    expect(dayStartIso("not-a-date")).toBeNull();
    expect(dayEndIso("2026-13-45")).toBeNull();
  });

  it("limit 归一化：缺省 20、最小 1、上限 100", () => {
    expect(normalizeBreachLimit()).toBe(BREACH_PAGE_SIZE);
    expect(normalizeBreachLimit(NaN)).toBe(BREACH_PAGE_SIZE);
    expect(normalizeBreachLimit(0)).toBe(1);
    expect(normalizeBreachLimit(1_000)).toBe(100);
    expect(normalizeBreachLimit(50)).toBe(50);
  });

  it("组装查询串：空筛选只带 limit，offset=0 不出现", () => {
    const query = buildBreachLedgerQuery({
      from: "",
      to: "",
      playerId: "",
      offset: 0,
    });
    expect(query).toBe("limit=20");
  });

  it("组装查询串：日期 + 陪玩 + 分页", () => {
    const query = buildBreachLedgerQuery({
      from: "2026-09-01",
      to: "2026-09-20",
      playerId: "11111111-1111-4111-8111-111111111111",
      offset: 20,
      limit: 20,
    });
    const params = new URLSearchParams(query);
    expect(params.get("from")).toBe(dayStartIso("2026-09-01"));
    expect(params.get("to")).toBe(dayEndIso("2026-09-20"));
    expect(params.get("playerId")).toBe("11111111-1111-4111-8111-111111111111");
    expect(params.get("offset")).toBe("20");
    expect(params.get("limit")).toBe("20");
  });
});
