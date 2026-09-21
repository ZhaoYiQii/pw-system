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
  buildSelectedCsv,
  buildSelectedCsvForColumns,
  clampPage,
  filterRows,
  groupByPlayer,
  normalizeListResponse,
  pageCount,
  paginate,
  rangeStartIso,
  RUSH_GAP_MINUTES,
  selectedSummary,
  sortRows,
  statusCounts,
  tabCounts,
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

describe("订单中心列表（Slice 1 新增纯逻辑）", () => {
  it("页签计数：全部取服务端 total，状态取当前数据集分布，脏输入回落 0", () => {
    const counts = tabCounts(
      ROWS,
      ["ALL", "DISPATCHING", "ASSIGNED", "COMPLETED"],
      42,
    );
    expect(counts).toEqual({
      ALL: 42,
      DISPATCHING: 1,
      ASSIGNED: 1,
      COMPLETED: 0,
    });
    // 服务端 total 缺失/非法时不把 NaN 渲染到页签上
    expect(tabCounts(ROWS, ["ALL"], Number.NaN)).toEqual({ ALL: 0 });
    expect(tabCounts(ROWS, ["ALL"], -3)).toEqual({ ALL: 0 });
  });

  it("时间范围 → 服务端 from 参数：今天从本地 00:00 起，近 3 天再往前两天，全部为空", () => {
    // 口径是**本地时区**的日历日，所以断言不能写死 UTC 偏移：
    // 先按本地日历日拼出当天 00:00，再断言返回的正是这个时刻。
    const pad = (value: number) => String(value).padStart(2, "0");
    const localMidnightOf = (date: Date) =>
      new Date(
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00`,
      );
    const today = localMidnightOf(NOW);
    expect(rangeStartIso("TODAY", NOW)).toBe(today.toISOString());
    // 近 3 天 = 今天 + 前两天（含边界）：比今天早 2 个日历日
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 2);
    expect(rangeStartIso("LAST_3D", NOW)).toBe(threeDaysAgo.toISOString());
    // 与「本地日历日」一致：返回时刻在本地的时分秒必须是 00:00:00
    const start = new Date(rangeStartIso("TODAY", NOW) ?? "");
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([
      0, 0, 0,
    ]);
    expect(
      rangeStartIso("LAST_3D", NOW)!.localeCompare(
        rangeStartIso("TODAY", NOW)!,
      ),
    ).toBeLessThan(0);
    expect(rangeStartIso("ALL", NOW)).toBeNull();
  });

  it("按陪玩分组：未选人单独一组，且不参与赶场判定", () => {
    const groups = groupByPlayer([
      row("a", "ASSIGNED", "2026-09-21T20:00:00+08:00", {
        playerName: "阿一",
      }),
      row("b", "ASSIGNED", "2026-09-21T19:00:00+08:00", {
        playerName: "阿一",
      }),
      row("c", "DRAFT", "2026-09-21T18:00:00+08:00", { playerName: null }),
      row("d", "DRAFT", "2026-09-21T17:00:00+08:00"),
    ]);
    expect(groups.map((group) => group.playerName)).toEqual(["阿一", null]);
    expect(groups[0]?.rows.map((item) => item.key)).toEqual(["a", "b"]);
    expect(groups[1]?.rows.map((item) => item.key)).toEqual(["c", "d"]);
    expect(groups.every((group) => group.rushKeys.length === 0)).toBe(true);
  });

  it("赶场提示：同陪玩两单间隔小于阈值标警示", () => {
    expect(RUSH_GAP_MINUTES).toBe(60);
    // 阿一：20:00 开单 90 分钟（到 21:30），下一单 22:00 → 间隔 30 分钟 < 60 → 双标
    const groups = groupByPlayer([
      row("a", "ASSIGNED", "2026-09-21T10:00:00+08:00", {
        playerName: "阿一",
        startAt: "2026-09-21T20:00:00+08:00",
        durationMinutes: 90,
      }),
      row("b", "ASSIGNED", "2026-09-21T10:10:00+08:00", {
        playerName: "阿一",
        startAt: "2026-09-21T22:00:00+08:00",
        durationMinutes: 60,
      }),
      // 阿二：两单间隔 3 小时 → 不标
      row("c", "ASSIGNED", "2026-09-21T10:20:00+08:00", {
        playerName: "阿二",
        startAt: "2026-09-21T20:00:00+08:00",
        durationMinutes: 60,
      }),
      row("d", "ASSIGNED", "2026-09-21T10:30:00+08:00", {
        playerName: "阿二",
        startAt: "2026-09-21T23:30:00+08:00",
        durationMinutes: 60,
      }),
    ]);
    const a = groups.find((group) => group.playerName === "阿一");
    const b = groups.find((group) => group.playerName === "阿二");
    expect(a?.rushKeys.sort()).toEqual(["a", "b"]);
    expect(b?.rushKeys).toEqual([]);
  });

  it("赶场提示：缺时间信息的行照常分组但不标警示（不臆造时间）", () => {
    const groups = groupByPlayer([
      row("a", "ASSIGNED", "2026-09-21T10:00:00+08:00", {
        playerName: "阿一",
        startAt: "2026-09-21T20:00:00+08:00",
      }),
      row("b", "ASSIGNED", "2026-09-21T10:10:00+08:00", {
        playerName: "阿一",
        startAt: "2026-09-21T20:30:00+08:00",
        durationMinutes: 30,
      }),
    ]);
    expect(groups[0]?.rows).toHaveLength(2);
    expect(groups[0]?.rushKeys).toEqual([]);
  });

  it("按选中导出：只含选中行、保持列表顺序、空选中返回 null", () => {
    const rows = [
      row("a", "DISPATCHING", "2026-09-21T20:00:00+08:00"),
      row("b", "ASSIGNED", "2026-09-21T19:00:00+08:00"),
      row("c", "CANCELLED", "2026-09-21T18:00:00+08:00"),
    ];
    expect(buildSelectedCsv(rows, new Set())).toBeNull();
    // 只有别的页的 key 被选中，当前数据集里没有可导出的行
    expect(buildSelectedCsv(rows, new Set(["z"]))).toBeNull();
    // 勾选顺序是 c,a，导出仍按列表顺序 a,c（与屏幕所见一致）
    const csv = buildSelectedCsv(rows, new Set(["c", "a"]));
    const lines = csv?.split("\n") ?? [];
    expect(lines).toHaveLength(3);
    expect(lines[1]?.startsWith("GD-a,")).toBe(true);
    expect(lines[2]?.startsWith("GD-c,")).toBe(true);
  });

  it("自定义列导出：列由调用方给，转义与选中过滤沿用同一实现", () => {
    const rows = [
      row("a", "DISPATCHING", "2026-09-21T20:00:00+08:00", {
        playerName: "阿一",
      }),
      row("b", "ASSIGNED", "2026-09-21T19:00:00+08:00", {
        playerName: "阿二",
      }),
    ];
    const csv = buildSelectedCsvForColumns(
      ["单号", "客户", "陪玩", "状态"],
      rows,
      new Set(["b"]),
      (item) => [
        item.no,
        item.customerName,
        item.playerName ?? "未选人",
        item.status,
      ],
    );
    expect(csv?.split("\n")).toEqual([
      "单号,客户,陪玩,状态",
      "GD-b,老板b,阿二,ASSIGNED",
    ]);
    expect(
      buildSelectedCsvForColumns(["单号"], rows, new Set(), () => ["x"]),
    ).toBeNull();
  });

  it("列表响应形状兜底：{data,total} 与「只剩数组」两种形状都能读出总数", () => {
    // 约定形状
    expect(
      normalizeListResponse({ data: [{ key: "a" }, { key: "b" }], total: 9 }),
    ).toEqual({ rows: [{ key: "a" }, { key: "b" }], total: 9 });
    // 取数层只交出 data 数组时，total 回落到长度（不把页面变成假空）
    expect(normalizeListResponse([{ key: "a" }])).toEqual({
      rows: [{ key: "a" }],
      total: 1,
    });
    // 脏输入
    expect(normalizeListResponse(null)).toEqual({ rows: [], total: 0 });
    expect(normalizeListResponse({ total: 3 })).toEqual({
      rows: [],
      total: 3,
    });
    expect(normalizeListResponse({ data: [{ a: 1 }], total: "x" })).toEqual({
      rows: [{ a: 1 }],
      total: 1,
    });
  });
});
