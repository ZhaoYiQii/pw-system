/**
 * 派单工作台列表增强（Slice 1）的纯逻辑单测。
 *
 * 覆盖：状态计数、时间范围（今天 / 近 3 天 / 全部）、关键字、排序、分页边界、
 * 勾选语义（单行 / 当页全选）、批量操作前的按状态汇总、导出 CSV。
 * 这些都是客户端派生逻辑，放在纯函数里便于先红后绿，也避免把未验证逻辑写进页面。
 */
import { describe, expect, it } from "vitest";
import {
  buildCsv,
  clampPage,
  filterRows,
  pageCount,
  paginate,
  selectedSummary,
  sortRows,
  statusCounts,
  toggleAllOnPage,
  toggleRow,
  type DispatchListRow,
} from "./dispatch-list-state.js";

const NOW = new Date("2026-09-21T21:30:00+08:00");

function row(
  key: string,
  status: string,
  createdAt: string,
  extra: Partial<DispatchListRow> = {},
): DispatchListRow {
  return {
    key,
    id: key,
    kind: "GD",
    no: `GD-${key}`,
    customerName: `老板${key}`,
    status,
    durationText: "60 分钟",
    createdAt,
    ...extra,
  };
}

const ROWS: DispatchListRow[] = [
  row("a", "DISPATCHING", "2026-09-21T20:00:00+08:00"),
  row("b", "ASSIGNED", "2026-09-21T19:00:00+08:00"),
  row("c", "PENDING_CONFIRMATION", "2026-09-20T22:00:00+08:00"),
  row("d", "PENDING_CONFIRMATION", "2026-09-18T10:00:00+08:00"),
  row("e", "CANCELLED", "2026-09-10T10:00:00+08:00"),
];

describe("派单工作台列表状态（纯函数）", () => {
  it("状态计数：按给定状态表逐项统计（含全部）", () => {
    const counts = statusCounts(ROWS, [
      "ALL",
      "DISPATCHING",
      "ASSIGNED",
      "PENDING_CONFIRMATION",
      "CANCELLED",
      "COMPLETED",
    ]);
    expect(counts).toEqual({
      ALL: 5,
      DISPATCHING: 1,
      ASSIGNED: 1,
      PENDING_CONFIRMATION: 2,
      CANCELLED: 1,
      COMPLETED: 0,
    });
  });

  it("时间范围：今天只留当天；近 3 天含今天与前两天；全部不过滤", () => {
    const base = { status: "ALL", query: "", sort: "CREATED_DESC" } as const;
    expect(
      filterRows(ROWS, { ...base, range: "TODAY" }, NOW).map((r) => r.key),
    ).toEqual(["a", "b"]);
    // 2026-09-21 往前 3 天：9/21、9/20、9/19 → c(9/20) 在内，d(9/18) 在外
    expect(
      filterRows(ROWS, { ...base, range: "LAST_3D" }, NOW).map((r) => r.key),
    ).toEqual(["a", "b", "c"]);
    expect(
      filterRows(ROWS, { ...base, range: "ALL" }, NOW).map((r) => r.key),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("状态 + 关键字组合过滤（大小写不敏感）", () => {
    const rows = filterRows(
      ROWS,
      {
        status: "PENDING_CONFIRMATION",
        query: "老板d",
        range: "ALL",
        sort: "CREATED_DESC",
      },
      NOW,
    );
    expect(rows.map((r) => r.key)).toEqual(["d"]);
    expect(
      filterRows(
        ROWS,
        { status: "ALL", query: "gd-c", range: "ALL", sort: "CREATED_DESC" },
        NOW,
      ).map((r) => r.key),
    ).toEqual(["c"]);
  });

  it("排序：创建时间倒序（默认）/ 正序 / 按状态表顺序", () => {
    expect(sortRows(ROWS, "CREATED_DESC").map((r) => r.key)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(sortRows(ROWS, "CREATED_ASC").map((r) => r.key)).toEqual([
      "e",
      "d",
      "c",
      "b",
      "a",
    ]);
    // 状态表顺序：DISPATCHING → ASSIGNED → PENDING_CONFIRMATION → CANCELLED
    const byStatus = sortRows(ROWS, "STATUS", [
      "DISPATCHING",
      "ASSIGNED",
      "PENDING_CONFIRMATION",
      "CANCELLED",
    ]);
    expect(byStatus.map((r) => r.status)).toEqual([
      "DISPATCHING",
      "ASSIGNED",
      "PENDING_CONFIRMATION",
      "PENDING_CONFIRMATION",
      "CANCELLED",
    ]);
    // 同状态内仍按创建时间倒序
    expect(byStatus.slice(2, 4).map((r) => r.key)).toEqual(["c", "d"]);
  });

  it("分页：页数计算与页码收敛（越界回落到最后一页）", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
    expect(clampPage(5, 5, 20)).toBe(1);
    expect(clampPage(2, 21, 20)).toBe(2);
    const page2 = paginate(ROWS, 2, 2);
    expect(page2.page).toBe(2);
    expect(page2.items.map((r) => r.key)).toEqual(["c", "d"]);
    expect(paginate(ROWS, 99, 2).page).toBe(3);
  });

  it("勾选：单行切换与「当页全选」语义（不跨页误选）", () => {
    let selected = new Set<string>();
    selected = toggleRow(selected, "a");
    expect([...selected]).toEqual(["a"]);
    selected = toggleRow(selected, "a");
    expect([...selected]).toEqual([]);

    const pageKeys = ["a", "b"];
    selected = toggleAllOnPage(new Set(["a"]), pageKeys);
    expect([...selected].sort()).toEqual(["a", "b"]);
    selected = toggleAllOnPage(new Set(["a", "b"]), pageKeys);
    expect([...selected]).toEqual([]);
    // 已选中的其他页记录不受影响
    expect([...toggleAllOnPage(new Set(["z"]), pageKeys)].sort()).toEqual([
      "a",
      "b",
      "z",
    ]);
  });

  it("批量操作前的按状态汇总（只对可操作的状态计数）", () => {
    const summary = selectedSummary(ROWS, new Set(["a", "c", "d", "e"]));
    expect(summary.count).toBe(4);
    expect(summary.byStatus).toEqual({
      DISPATCHING: 1,
      PENDING_CONFIRMATION: 2,
      CANCELLED: 1,
    });
  });

  it("导出 CSV：带表头、转义逗号与引号、保持传入顺序", () => {
    const csv = buildCsv([
      row("x", "DISPATCHING", "2026-09-21T20:00:00+08:00", {
        customerName: '老"板",甲',
      }),
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("单号,类型,客户,时长,状态,创建时间");
    expect(lines[1]).toContain('"老""板"",甲"');
    expect(lines[1]?.startsWith("GD-x,GD,")).toBe(true);
  });
});
