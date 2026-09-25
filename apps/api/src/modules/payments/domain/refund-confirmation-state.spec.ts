import { describe, expect, it } from "vitest";
import {
  REFUND_STATUSES,
  RefundStatusTransitionError,
  assertRefundStatusTransition,
} from "./refund-confirmation-state.js";
import type { RefundStatus } from "./refund-confirmation-state.js";

const ALL_STATUSES: RefundStatus[] = [
  "PENDING_CONFIRMATION",
  "SUCCEEDED",
  "REJECTED",
  "CANCELLED",
];

const TERMINAL_STATUSES: RefundStatus[] = [
  "SUCCEEDED",
  "REJECTED",
  "CANCELLED",
];

const ALLOWED_TRANSITIONS: Array<[RefundStatus, RefundStatus]> = [
  ["PENDING_CONFIRMATION", "SUCCEEDED"],
  ["PENDING_CONFIRMATION", "REJECTED"],
  ["PENDING_CONFIRMATION", "CANCELLED"],
];

/** 取出 assert 抛出的错误以便检查类型与文案；没抛错直接失败，不静默放过。 */
function catchError(run: () => void): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("预期 assertRefundStatusTransition 抛出错误，但实际没有抛出");
}

describe("退款确认状态机（DS-004 状态流转规则）", () => {
  it("允许状态常量恰好是四个已知状态，无重复无遗漏", () => {
    expect([...REFUND_STATUSES]).toEqual(ALL_STATUSES);
    expect(new Set(REFUND_STATUSES).size).toBe(REFUND_STATUSES.length);
    // 守卫以此数组为运行时依据，必须冻结，不能被同进程代码 push 出第五个状态。
    expect(Object.isFrozen(REFUND_STATUSES)).toBe(true);
  });

  it("PENDING_CONFIRMATION 可分别转到三个终态，且不返回业务数据", () => {
    for (const [from, to] of ALLOWED_TRANSITIONS) {
      const label = `${from} -> ${to}`;
      expect(() => assertRefundStatusTransition(from, to), label).not.toThrow();
      expect(assertRefundStatusTransition(from, to), label).toBeUndefined();
    }
  });

  it("每个终态都不可再转移（含终态之间互转）", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(
          () => assertRefundStatusTransition(from, to),
          `${from} -> ${to}`,
        ).toThrow(RefundStatusTransitionError);
      }
    }
  });

  it("不可自转移：初始状态与终态都拒绝转回自身", () => {
    for (const status of ALL_STATUSES) {
      expect(
        () => assertRefundStatusTransition(status, status),
        status,
      ).toThrow(RefundStatusTransitionError);
    }
  });

  it("未知 from 或 to 一律拒绝，不默认允许", () => {
    expect(() =>
      assertRefundStatusTransition(
        "PENDING_PAYOUT" as RefundStatus,
        "SUCCEEDED",
      ),
    ).toThrow(RefundStatusTransitionError);
    expect(() =>
      assertRefundStatusTransition(
        "PENDING_CONFIRMATION",
        "REFUNDED" as RefundStatus,
      ),
    ).toThrow(RefundStatusTransitionError);
    expect(() =>
      assertRefundStatusTransition("" as RefundStatus, "" as RefundStatus),
    ).toThrow(RefundStatusTransitionError);
    // 原型链上的属性名不能被误判为已知状态
    expect(() =>
      assertRefundStatusTransition("constructor" as RefundStatus, "SUCCEEDED"),
    ).toThrow(RefundStatusTransitionError);
    expect(() =>
      assertRefundStatusTransition(
        "toString" as RefundStatus,
        "toString" as RefundStatus,
      ),
    ).toThrow(RefundStatusTransitionError);
  });

  it("非法转移抛出专用错误，且错误信息包含 from 与 to", () => {
    const error = catchError(() =>
      assertRefundStatusTransition("SUCCEEDED", "PENDING_CONFIRMATION"),
    );

    expect(error).toBeInstanceOf(RefundStatusTransitionError);
    expect(error.name).toBe("RefundStatusTransitionError");
    expect(error.message).toContain("SUCCEEDED");
    expect(error.message).toContain("PENDING_CONFIRMATION");
  });

  it("错误信息不泄露金额、客户、银行卡或退款单号", () => {
    const pairs: Array<[RefundStatus, RefundStatus]> = [
      ["SUCCEEDED", "PENDING_CONFIRMATION"],
      ["REJECTED", "SUCCEEDED"],
      ["CANCELLED", "PENDING_CONFIRMATION"],
      ["PENDING_CONFIRMATION", "PENDING_CONFIRMATION"],
      ["NOPE" as RefundStatus, "SUCCEEDED"],
    ];

    for (const [from, to] of pairs) {
      const { message } = catchError(() =>
        assertRefundStatusTransition(from, to),
      );
      const label = `${from} -> ${to}`;
      // 状态名只有字母与下划线：出现数字或掩码符号就说明混入了金额/卡号/单号等业务数据。
      expect(message, label).not.toMatch(/\d/);
      expect(message, label).not.toMatch(/[*@]/);
      expect(message, label).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
      expect(message, label).not.toMatch(
        /customer|client|card|refundNo|outRefundNo|客户档案/i,
      );
    }
  });

  it("未知状态走私的控制字符、换行与数字被就地中和，无法伪造审计行", () => {
    const smuggled = catchError(() =>
      assertRefundStatusTransition(
        "SUCCEEDED\n[AUDIT] amount=500000" as RefundStatus,
        "CANCELLED",
      ),
    );

    expect(smuggled).toBeInstanceOf(RefundStatusTransitionError);
    // 状态名的合法字符集只有字母与下划线：任何 C0/DEL 控制字符（含换行与 ESC）、方括号、数字都必须被替换掉。
    const controlChars = [...smuggled.message].filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    });
    expect(controlChars, "错误信息不得含控制字符").toEqual([]);
    expect(smuggled.message).not.toMatch(/\d/);
    expect(smuggled.message).not.toMatch(/[[\]]/);
    // 长度受限，避免用超长未知状态刷日志。
    expect(smuggled.message.length).toBeLessThan(100);
  });
});
