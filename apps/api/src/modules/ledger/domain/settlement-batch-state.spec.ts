import { describe, expect, it } from "vitest";
import {
  assertSettlementBatchTransition,
  canTransitionSettlementBatch,
} from "./settlement-batch-state.js";
import type { SettlementBatchStatus } from "./settlement-batch-state.js";

const ALL_STATUSES: SettlementBatchStatus[] = [
  "DRAFT",
  "REVIEWED",
  "APPROVED",
  "PAID",
  "VOID",
];

const ALLOWED_TRANSITIONS: Array<
  [SettlementBatchStatus, SettlementBatchStatus]
> = [
  ["DRAFT", "REVIEWED"],
  ["DRAFT", "VOID"],
  ["REVIEWED", "APPROVED"],
  ["REVIEWED", "VOID"],
  ["APPROVED", "PAID"],
];

describe("结算批次状态机（DS-001 状态流转规则）", () => {
  it("五条允许流转全部放行", () => {
    for (const [from, to] of ALLOWED_TRANSITIONS) {
      expect(canTransitionSettlementBatch(from, to), `${from} -> ${to}`).toBe(
        true,
      );
    }
  });

  it("状态不可跳跃", () => {
    expect(canTransitionSettlementBatch("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionSettlementBatch("DRAFT", "PAID")).toBe(false);
    expect(canTransitionSettlementBatch("REVIEWED", "PAID")).toBe(false);
  });

  it("状态不可回退", () => {
    expect(canTransitionSettlementBatch("REVIEWED", "DRAFT")).toBe(false);
    expect(canTransitionSettlementBatch("APPROVED", "REVIEWED")).toBe(false);
    expect(canTransitionSettlementBatch("APPROVED", "DRAFT")).toBe(false);
    expect(canTransitionSettlementBatch("PAID", "APPROVED")).toBe(false);
    expect(canTransitionSettlementBatch("VOID", "DRAFT")).toBe(false);
  });

  it("状态不可自迁移", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionSettlementBatch(status, status), status).toBe(false);
    }
  });

  it("PAID 与 VOID 是终态，无任何后续迁移", () => {
    for (const status of ALL_STATUSES) {
      expect(
        canTransitionSettlementBatch("PAID", status),
        `PAID -> ${status}`,
      ).toBe(false);
      expect(
        canTransitionSettlementBatch("VOID", status),
        `VOID -> ${status}`,
      ).toBe(false);
    }
  });

  it("未知状态一律拒绝，不能默认允许", () => {
    expect(
      canTransitionSettlementBatch("UNKNOWN" as SettlementBatchStatus, "PAID"),
    ).toBe(false);
    expect(
      canTransitionSettlementBatch("DRAFT", "unknown" as SettlementBatchStatus),
    ).toBe(false);
    expect(
      canTransitionSettlementBatch(
        "" as SettlementBatchStatus,
        "" as SettlementBatchStatus,
      ),
    ).toBe(false);
    // 原型链上的属性名不能被误判为已知状态
    expect(
      canTransitionSettlementBatch(
        "constructor" as SettlementBatchStatus,
        "PAID",
      ),
    ).toBe(false);
    expect(
      canTransitionSettlementBatch(
        "toString" as SettlementBatchStatus,
        "toString" as SettlementBatchStatus,
      ),
    ).toBe(false);
  });

  it("assert 放行合法流转且不抛错", () => {
    for (const [from, to] of ALLOWED_TRANSITIONS) {
      expect(
        () => assertSettlementBatchTransition(from, to),
        `${from} -> ${to}`,
      ).not.toThrow();
    }
  });

  it("assert 拒绝非法流转时抛出错误，且错误信息包含 from 与 to", () => {
    let message = "";
    try {
      assertSettlementBatchTransition("DRAFT", "PAID");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("DRAFT");
    expect(message).toContain("PAID");
  });

  it("assert 对未知状态同样抛出错误，且错误信息包含 from 与 to", () => {
    expect(() =>
      assertSettlementBatchTransition("BOGUS" as SettlementBatchStatus, "PAID"),
    ).toThrow();
    expect(() =>
      assertSettlementBatchTransition(
        "DRAFT",
        "BOGUS" as SettlementBatchStatus,
      ),
    ).toThrow();

    let message = "";
    try {
      assertSettlementBatchTransition(
        "DRAFT",
        "BOGUS" as SettlementBatchStatus,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("DRAFT");
    expect(message).toContain("BOGUS");
  });
});
