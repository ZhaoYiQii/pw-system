import { describe, expect, it } from "vitest";
import * as caseState from "./reconciliation-case-state.js";
import {
  RECONCILIATION_CASE_STATUSES,
  ReconciliationCaseTransitionError,
  assertReconciliationCaseTransition,
  canTransitionReconciliationCase,
  isReconciliationCaseTerminalStatus,
} from "./reconciliation-case-state.js";
import type { ReconciliationCaseStatus } from "./reconciliation-case-state.js";

/**
 * 以下三张表都是独立于实现的事实来源：直接抄自 DS-010 任务包固定的状态拓扑，
 * 不读取实现内部的转移表，因此实现与拓扑漂移时这些测试必须失败。
 */
const ALL_STATUSES: ReconciliationCaseStatus[] = [
  "OPEN",
  "CLAIMED",
  "PROCESSING",
  "PENDING_REVIEW",
  "CLOSED",
  "IGNORED",
];

const TERMINAL_STATUSES: ReconciliationCaseStatus[] = ["CLOSED", "IGNORED"];

const ALLOWED_TRANSITIONS: Array<
  [ReconciliationCaseStatus, ReconciliationCaseStatus]
> = [
  ["OPEN", "CLAIMED"],
  ["OPEN", "IGNORED"],
  ["CLAIMED", "PROCESSING"],
  ["CLAIMED", "IGNORED"],
  ["PROCESSING", "PENDING_REVIEW"],
  ["PENDING_REVIEW", "CLOSED"],
];

/** 错误消息模板：只允许固定文案 + 两个安全短标签，杜绝任何原始自由文本进入日志。 */
const SAFE_MESSAGE =
  /^对账处理单状态不允许从 ([A-Za-z_?]+) 变更为 ([A-Za-z_?]+)$/;

function isListedAllowed(
  from: ReconciliationCaseStatus,
  to: ReconciliationCaseStatus,
): boolean {
  return ALLOWED_TRANSITIONS.some(
    ([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to,
  );
}

/** 取出 assert 抛出的错误以便检查类型与文案；没抛错直接失败，不静默放过。 */
function catchError(run: () => void): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error(
    "预期 assertReconciliationCaseTransition 抛出错误，但实际没有抛出",
  );
}

/**
 * 不安全调用方可传入的任意运行时值：未知状态名、原型链属性名、
 * 含控制字符/自由文本的走私字符串，以及非字符串类型。
 */
const UNKNOWN_VALUES: unknown[] = [
  "",
  "REOPENED",
  "open",
  "OPEN ",
  "constructor",
  "toString",
  "__proto__",
  "hasOwnProperty",
  "CLOSED\n[FAKE]",
  "OPEN\n[AUDIT] note=客户已退款 amount=500000",
  42,
  0,
  null,
  undefined,
  {},
  [],
];

/** 同一对 from/to 必须口径一致：can 返回 false 且不抛错，assert 抛专用错误。 */
function expectRejected(
  from: unknown,
  to: unknown,
): ReconciliationCaseTransitionError {
  let allowed: boolean | undefined;
  expect(() => {
    allowed = canTransitionReconciliationCase(
      from as ReconciliationCaseStatus,
      to as ReconciliationCaseStatus,
    );
  }).not.toThrow();
  expect(allowed, `${String(from)} -> ${String(to)}`).toBe(false);

  const error = catchError(() =>
    assertReconciliationCaseTransition(
      from as ReconciliationCaseStatus,
      to as ReconciliationCaseStatus,
    ),
  );
  expect(error).toBeInstanceOf(ReconciliationCaseTransitionError);
  return error as ReconciliationCaseTransitionError;
}

describe("对账处理单状态机（DS-010 状态拓扑）", () => {
  it("导出的状态常量恰好是六个已知状态，无重复且运行时不可改写", () => {
    expect([...RECONCILIATION_CASE_STATUSES]).toEqual(ALL_STATUSES);
    expect(new Set(RECONCILIATION_CASE_STATUSES).size).toBe(
      ALL_STATUSES.length,
    );
    expect(Object.isFrozen(RECONCILIATION_CASE_STATUSES)).toBe(true);

    // 已知状态判定以该常量为运行时依据：任何改写尝试都不得改变内容。
    const mutable =
      RECONCILIATION_CASE_STATUSES as unknown as ReconciliationCaseStatus[];
    const attempts: Array<() => void> = [
      () => mutable.push("REOPENED" as ReconciliationCaseStatus),
      () => mutable.splice(0, 1),
      () => {
        mutable[0] = "REOPENED" as ReconciliationCaseStatus;
      },
    ];
    for (const attempt of attempts) {
      try {
        attempt();
      } catch {
        // 冻结数组在严格模式下抛 TypeError，这里只关心内容是否被改动。
      }
    }
    expect([...RECONCILIATION_CASE_STATUSES]).toEqual(ALL_STATUSES);
  });

  it("六条合法转移全部允许，且 assert 不返回业务数据", () => {
    expect(ALLOWED_TRANSITIONS).toHaveLength(6);
    for (const [from, to] of ALLOWED_TRANSITIONS) {
      const label = `${from} -> ${to}`;
      expect(canTransitionReconciliationCase(from, to), label).toBe(true);
      expect(
        () => assertReconciliationCaseTransition(from, to),
        label,
      ).not.toThrow();
      expect(
        assertReconciliationCaseTransition(from, to),
        label,
      ).toBeUndefined();
    }
  });

  it("穷尽 6×6 组合：只有固定拓扑中的六对允许，其余全部拒绝", () => {
    let allowedCount = 0;
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const label = `${from} -> ${to}`;
        const expected = isListedAllowed(from, to);
        if (expected) allowedCount += 1;
        expect(canTransitionReconciliationCase(from, to), label).toBe(expected);
      }
    }
    expect(allowedCount).toBe(ALLOWED_TRANSITIONS.length);
  });

  it("不能跳过认领：OPEN 直接到 PROCESSING / PENDING_REVIEW / CLOSED 均被拒绝", () => {
    const skipsClaim: ReconciliationCaseStatus[] = [
      "PROCESSING",
      "PENDING_REVIEW",
      "CLOSED",
    ];
    for (const to of skipsClaim) {
      expectRejected("OPEN", to);
    }
  });

  it("不能跳过实际处理或复核：CLAIMED 直接复核/关闭、PROCESSING 直接关闭均被拒绝", () => {
    expectRejected("CLAIMED", "PENDING_REVIEW");
    expectRejected("CLAIMED", "CLOSED");
    expectRejected("PROCESSING", "CLOSED");
  });

  it("PROCESSING 之后不能忽略；所有回退与自迁移被拒绝", () => {
    expectRejected("PROCESSING", "IGNORED");

    const backwards: Array<
      [ReconciliationCaseStatus, ReconciliationCaseStatus]
    > = [
      ["CLAIMED", "OPEN"],
      ["PROCESSING", "OPEN"],
      ["PROCESSING", "CLAIMED"],
      ["PENDING_REVIEW", "OPEN"],
      ["PENDING_REVIEW", "CLAIMED"],
      ["PENDING_REVIEW", "PROCESSING"],
    ];
    for (const [from, to] of backwards) {
      expectRejected(from, to);
    }

    for (const status of ALL_STATUSES) {
      expectRejected(status, status);
    }
  });

  it("CLOSED 与 IGNORED 的所有出边被拒绝，且仅这两个状态是终态", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expectRejected(from, to);
      }
    }
    for (const status of ALL_STATUSES) {
      expect(isReconciliationCaseTerminalStatus(status), status).toBe(
        TERMINAL_STATUSES.includes(status),
      );
    }
    expect(TERMINAL_STATUSES).toHaveLength(2);
  });

  it("未知 from / to、原型链属性名与含控制字符的伪状态一律安全拒绝", () => {
    for (const unknown of UNKNOWN_VALUES) {
      expectRejected(unknown, "OPEN");
      expectRejected("OPEN", unknown);
      expect(
        canTransitionReconciliationCase(
          unknown as ReconciliationCaseStatus,
          unknown as ReconciliationCaseStatus,
        ),
        String(unknown),
      ).toBe(false);
      // 未知运行时输入不得被当成终态。
      expect(
        isReconciliationCaseTerminalStatus(unknown as ReconciliationCaseStatus),
      ).toBe(false);
    }
    expectRejected("constructor", "constructor");
    expectRejected("__proto__", "toString");
  });

  it("专用错误类型与名称正确，消息包含安全的 from / to 标签", () => {
    const error = expectRejected("CLOSED", "OPEN");
    expect(error.name).toBe("ReconciliationCaseTransitionError");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("CLOSED");
    expect(error.message).toContain("OPEN");
    expect(error.message).toMatch(SAFE_MESSAGE);
  });

  it("错误消息不形成换行、控制字符或日志注入，且不回显自由文本", () => {
    const errors: Error[] = [
      expectRejected("CLOSED", "OPEN"),
      expectRejected("PENDING_REVIEW", "OPEN"),
      catchError(() =>
        assertReconciliationCaseTransition(
          "OPEN\n[AUDIT] note=客户已退款 amount=500000" as ReconciliationCaseStatus,
          "CLOSED",
        ),
      ),
      catchError(() =>
        assertReconciliationCaseTransition(
          "PENDING_REVIEW",
          "CLOSED\n[INFO] operator=张三\r\n" as ReconciliationCaseStatus,
        ),
      ),
    ];

    for (const error of errors) {
      const controlChars = [...error.message].filter((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code < 0x20 || code === 0x7f;
      });
      expect(controlChars, "错误信息不得含控制字符").toEqual([]);
      // 固定文案 + 安全短标签：任何原始输入（金额、单号、备注、操作人）都无法进入消息。
      expect(error.message).toMatch(SAFE_MESSAGE);
      expect(error.message).not.toMatch(/\d/);
      expect(error.message).not.toMatch(/[[\]*@]/);
      expect(error.message).not.toMatch(/客户|退款|渠道|银行卡|张三/);
      // 长度受限，避免用超长未知状态刷日志。
      expect(error.message.length).toBeLessThan(100);
    }
  });

  it("导出面只有查验与断言入口，不含自动认领/自动复核/自动关闭/自动忽略", () => {
    const names = Object.keys(caseState);
    for (const required of [
      "RECONCILIATION_CASE_STATUSES",
      "ReconciliationCaseTransitionError",
      "assertReconciliationCaseTransition",
      "canTransitionReconciliationCase",
      "isReconciliationCaseTerminalStatus",
    ]) {
      expect(names, `缺少导出 ${required}`).toContain(required);
    }
    expect(
      names.filter((name) =>
        /^(auto|apply|advance|claim|close|ignore|reopen)/i.test(name),
      ),
    ).toEqual([]);
    expect(typeof caseState.canTransitionReconciliationCase).toBe("function");
    expect(typeof caseState.assertReconciliationCaseTransition).toBe(
      "function",
    );
    expect(typeof caseState.isReconciliationCaseTerminalStatus).toBe(
      "function",
    );
    expect(typeof caseState.RECONCILIATION_CASE_STATUSES).toBe("object");
    expect(typeof caseState.ReconciliationCaseTransitionError).toBe("function");
  });
});
