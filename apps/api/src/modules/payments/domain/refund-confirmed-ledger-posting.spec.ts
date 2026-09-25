import { describe, expect, it } from "vitest";
import { CUSTOMER_AUXILIARY_TYPE } from "./payment-confirmed-ledger-posting.js";
import { RefundStatusTransitionError } from "./refund-confirmation-state.js";
import {
  REFUND_CONFIRMABLE_STATUS,
  REFUND_CONFIRMED_EVENT_TYPE,
  REFUND_CONFIRMED_SOURCE_TYPE,
  REFUND_CONFIRMED_STATUS,
  REFUND_OCCUPYING_STATUSES,
  REFUND_SUCCEEDED_STATUS,
  RefundConfirmedInputError,
  assertRefundConfirmable,
  buildRefundConfirmedLedgerPosting,
} from "./refund-confirmed-ledger-posting.js";

/**
 * DS-005：退款确认总账草稿的纯单测。
 *
 * 口径来自已批准的业务事实：**退款申请不等于已退款**。只有门店实际把钱退给客户、
 * 财务确认之后，才在这个转换上冲销总账——借客户预收款（负债减少）、贷微信渠道待结算资产（钱流出）。
 * 记账方向与 DS-003 的支付入账**严格相反**，这是本文件最重要的一条断言。
 */

const CONFIRMED_AT = new Date("2026-09-24T03:00:00.000Z");

const INPUT = {
  amountFen: 5000n,
  fundAccountId: "11111111-1111-1111-1111-111111111111",
  refundId: "22222222-2222-2222-2222-222222222222",
  outRefundNo: "MRABC123",
  customerProfileId: "33333333-3333-3333-3333-333333333333",
  confirmedAt: CONFIRMED_AT,
} as const;

describe("DS-005：退款确认总账草稿（纯领域口径）", () => {
  it("口径常量：来源 payment_refund、事件 REFUND_CONFIRMED、状态 CONFIRMED", () => {
    expect(REFUND_CONFIRMED_SOURCE_TYPE).toBe("payment_refund");
    expect(REFUND_CONFIRMED_EVENT_TYPE).toBe("REFUND_CONFIRMED");
    expect(REFUND_CONFIRMED_STATUS).toBe("CONFIRMED");
  });

  it("借贷方向与支付入账严格相反：借客户预收款（不挂资金账户）、贷微信渠道待结算资产（挂原资金账户）", () => {
    const { entries } = buildRefundConfirmedLedgerPosting(INPUT);
    expect(entries).toHaveLength(2);

    const [debit, credit] = entries;
    expect(debit.direction).toBe("DEBIT");
    expect(debit.accountCode).toBe("CUSTOMER_PREPAID_LIABILITY");
    // 客户负债不落在任何资金账户上（资金账户只描述钱实际在哪）
    expect(debit.fundAccountId).toBeNull();

    expect(credit.direction).toBe("CREDIT");
    expect(credit.accountCode).toBe("WECHAT_SETTLEMENT_ASSET");
    // 钱从原支付资金账户流出，必须挂回原账户才能按资金账户对账
    expect(credit.fundAccountId).toBe(INPUT.fundAccountId);
  });

  it("两条分录金额严格相等、等于退款金额且都挂客户辅助核算", () => {
    const { entries } = buildRefundConfirmedLedgerPosting(INPUT);
    for (const entry of entries) {
      expect(entry.amountFen).toBe(INPUT.amountFen);
      expect(entry.auxiliaryType).toBe(CUSTOMER_AUXILIARY_TYPE);
      expect(entry.auxiliaryId).toBe(INPUT.customerProfileId);
    }
  });

  it("借贷平衡且方向各一条：分别求和必须相等（独立复算，不依赖被测算术）", () => {
    const { entries } = buildRefundConfirmedLedgerPosting({
      ...INPUT,
      amountFen: 12800n,
    });
    let debitFen = 0n;
    let creditFen = 0n;
    for (const entry of entries) {
      if (entry.direction === "DEBIT") debitFen += entry.amountFen;
      else creditFen += entry.amountFen;
    }
    expect(debitFen).toBe(12800n);
    expect(creditFen).toBe(12800n);
    expect(debitFen).toBe(creditFen);
  });

  it("交易头：来源指向退款单、锚定原支付资金账户、发生与确认时间同为本次确认时间", () => {
    const { transaction } = buildRefundConfirmedLedgerPosting(INPUT);
    expect(transaction.sourceType).toBe(REFUND_CONFIRMED_SOURCE_TYPE);
    expect(transaction.sourceId).toBe(INPUT.refundId);
    expect(transaction.eventType).toBe(REFUND_CONFIRMED_EVENT_TYPE);
    expect(transaction.status).toBe(REFUND_CONFIRMED_STATUS);
    // 交易头资金账户决定「按资金账户查总账交易」能否查到这笔冲销
    expect(transaction.fundAccountId).toBe(INPUT.fundAccountId);
    expect(transaction.occurredAt).toBe(CONFIRMED_AT);
    expect(transaction.confirmedAt).toBe(CONFIRMED_AT);
    // 描述带退款单号，人工追溯时不必再查库
    expect(transaction.description).toContain(INPUT.outRefundNo);
  });

  it("金额必须是大于 0 的整数分：0、负数、非 bigint 一律拒绝，不做静默纠正", () => {
    for (const amountFen of [0n, -1n, -5000n]) {
      expect(
        () => buildRefundConfirmedLedgerPosting({ ...INPUT, amountFen }),
        String(amountFen),
      ).toThrow(RefundConfirmedInputError);
    }
    for (const amountFen of [5000, "5000", null, undefined]) {
      expect(
        () =>
          buildRefundConfirmedLedgerPosting({
            ...INPUT,
            amountFen: amountFen as unknown as bigint,
          }),
        String(amountFen),
      ).toThrow(RefundConfirmedInputError);
    }
    expect(() =>
      buildRefundConfirmedLedgerPosting({ ...INPUT, amountFen: 1n }),
    ).not.toThrow();
  });

  it("是纯函数：不改写入参，同一入参两次得到等价结果", () => {
    const frozen = Object.freeze({ ...INPUT });
    const first = buildRefundConfirmedLedgerPosting(frozen);
    const second = buildRefundConfirmedLedgerPosting(frozen);
    expect(second).toEqual(first);
    expect(frozen).toEqual(INPUT);
    // 时间对象是同一个引用（不做隐式拷贝或改写）
    expect(frozen.confirmedAt).toBe(CONFIRMED_AT);
  });

  it("占用额度状态 = 待确认 + 已确认；被拒/撤销的终态不占用额度", () => {
    expect([...REFUND_OCCUPYING_STATUSES]).toEqual([
      REFUND_CONFIRMABLE_STATUS,
      REFUND_SUCCEEDED_STATUS,
    ]);
    expect(REFUND_CONFIRMABLE_STATUS).toBe("PENDING_CONFIRMATION");
    expect(REFUND_SUCCEEDED_STATUS).toBe("SUCCEEDED");
    expect(REFUND_OCCUPYING_STATUSES).not.toContain("REJECTED");
    expect(REFUND_OCCUPYING_STATUSES).not.toContain("CANCELLED");
    expect(Object.isFrozen(REFUND_OCCUPYING_STATUSES)).toBe(true);
  });

  it("复用 DS-004 状态机：只有 PENDING_CONFIRMATION 可确认，终态与未知状态一律拒绝", () => {
    expect(() => assertRefundConfirmable("PENDING_CONFIRMATION")).not.toThrow();
    for (const status of ["SUCCEEDED", "REJECTED", "CANCELLED"]) {
      expect(() => assertRefundConfirmable(status), status).toThrow(
        RefundStatusTransitionError,
      );
    }
    for (const status of ["CREATED", "", "paid", "PENDING", "constructor"]) {
      expect(() => assertRefundConfirmable(status), status).toThrow(
        RefundStatusTransitionError,
      );
    }
    // 重复确认的错误信息只含状态名，不含金额或单号
    let message = "";
    try {
      assertRefundConfirmable("SUCCEEDED");
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("SUCCEEDED");
    expect(message).not.toMatch(/\d/);
    expect(message).not.toContain("MRABC123");
  });
});
