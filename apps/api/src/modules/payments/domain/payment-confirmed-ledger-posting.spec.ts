import { beforeEach, describe, expect, it, vi } from "vitest";

// 包一层 spy 保留原实现：用来证明领域函数确实经过既有守卫，而不是自己另写一套平衡判断。
vi.mock("../../ledger/domain/funds.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../ledger/domain/funds.js")>();
  return {
    ...actual,
    assertBalancedFundEntries: vi.fn(actual.assertBalancedFundEntries),
  };
});

import { assertBalancedFundEntries } from "../../ledger/domain/funds.js";
import {
  CUSTOMER_AUXILIARY_TYPE,
  CUSTOMER_PREPAID_LIABILITY_ACCOUNT,
  PAYMENT_CONFIRMED_EVENT_TYPE,
  PAYMENT_CONFIRMED_SOURCE_TYPE,
  PAYMENT_CONFIRMED_STATUS,
  PaymentConfirmedInputError,
  WECHAT_SETTLEMENT_ASSET_ACCOUNT,
  buildPaymentConfirmedLedgerPosting,
} from "./payment-confirmed-ledger-posting.js";
import type { PaymentConfirmedPostingInput } from "./payment-confirmed-ledger-posting.js";

const PAID_AT = new Date("2026-09-24T06:00:00.000Z");
const FUND_ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const CUSTOMER_PROFILE_ID = "22222222-2222-2222-2222-222222222222";

function validInput(
  overrides: Partial<PaymentConfirmedPostingInput> = {},
): PaymentConfirmedPostingInput {
  return {
    amountFen: 12800n,
    fundAccountId: FUND_ACCOUNT_ID,
    paymentOrderId: "33333333-3333-3333-3333-333333333333",
    paymentOrderOutNo: "PO20260924000001",
    customerProfileId: CUSTOMER_PROFILE_ID,
    paidAt: PAID_AT,
    ...overrides,
  };
}

describe("微信支付确认入账领域口径（DS-003）", () => {
  beforeEach(() => {
    vi.mocked(assertBalancedFundEntries).mockClear();
  });

  it("生成恰好一借一贷，金额相同且等于支付单金额", () => {
    const posting = buildPaymentConfirmedLedgerPosting(validInput());

    expect(posting.entries).toHaveLength(2);
    const [debit, credit] = posting.entries;
    expect(debit.direction).toBe("DEBIT");
    expect(credit.direction).toBe("CREDIT");
    expect(debit.amountFen).toBe(12800n);
    expect(credit.amountFen).toBe(debit.amountFen);
  });

  it("科目、资金账户与客户辅助核算按固定口径落到正确的一侧", () => {
    const [debit, credit] = buildPaymentConfirmedLedgerPosting(
      validInput(),
    ).entries;

    expect(debit.accountCode).toBe(WECHAT_SETTLEMENT_ASSET_ACCOUNT.code);
    expect(debit.accountCode).toBe("WECHAT_SETTLEMENT_ASSET");
    expect(credit.accountCode).toBe(CUSTOMER_PREPAID_LIABILITY_ACCOUNT.code);
    expect(credit.accountCode).toBe("CUSTOMER_PREPAID_LIABILITY");

    // 资金账户只挂在借方（资产）一侧；贷方是客户负债，不挂资金账户。
    expect(debit.fundAccountId).toBe(FUND_ACCOUNT_ID);
    expect(credit.fundAccountId).toBeNull();

    for (const entry of [debit, credit]) {
      expect(entry.auxiliaryType).toBe(CUSTOMER_AUXILIARY_TYPE);
      expect(entry.auxiliaryType).toBe("customer_profile");
      expect(entry.auxiliaryId).toBe(CUSTOMER_PROFILE_ID);
    }
  });

  it("交易头写入来源、事件、状态与微信回调 paidAt", () => {
    const { transaction } = buildPaymentConfirmedLedgerPosting(validInput());

    expect(transaction.sourceType).toBe(PAYMENT_CONFIRMED_SOURCE_TYPE);
    expect(transaction.sourceType).toBe("payment_order");
    expect(transaction.sourceId).toBe("33333333-3333-3333-3333-333333333333");
    expect(transaction.eventType).toBe(PAYMENT_CONFIRMED_EVENT_TYPE);
    expect(transaction.eventType).toBe("PAYMENT_CONFIRMED");
    expect(transaction.status).toBe(PAYMENT_CONFIRMED_STATUS);
    expect(transaction.status).toBe("CONFIRMED");
    expect(transaction.fundAccountId).toBe(FUND_ACCOUNT_ID);

    expect(transaction.occurredAt.getTime()).toBe(PAID_AT.getTime());
    expect(transaction.confirmedAt.getTime()).toBe(PAID_AT.getTime());
  });

  it("描述包含支付单 outNo，并表明微信支付充值已确认", () => {
    const { transaction } = buildPaymentConfirmedLedgerPosting(
      validInput({ paymentOrderOutNo: "PO20260924000099" }),
    );

    expect(transaction.description).toContain("PO20260924000099");
    expect(transaction.description).toContain("微信支付充值已确认");
  });

  it("金额为零或负数一律明确拒绝，且不触及守卫", () => {
    for (const amountFen of [0n, -1n, -12800n]) {
      expect(
        () => buildPaymentConfirmedLedgerPosting(validInput({ amountFen })),
        `amountFen=${amountFen}`,
      ).toThrow(PaymentConfirmedInputError);
    }
    expect(vi.mocked(assertBalancedFundEntries)).not.toHaveBeenCalled();
  });

  it("非 bigint 金额（受控类型断言模拟越界输入）同样被拒绝", () => {
    expect(() =>
      buildPaymentConfirmedLedgerPosting(
        validInput({ amountFen: 12800 as unknown as bigint }),
      ),
    ).toThrow(PaymentConfirmedInputError);
  });

  it("确实经 assertBalancedFundEntries() 守卫，且传入的两条分录借贷平衡", () => {
    buildPaymentConfirmedLedgerPosting(validInput());

    const guard = vi.mocked(assertBalancedFundEntries);
    expect(guard).toHaveBeenCalledTimes(1);
    const drafts = guard.mock.calls[0]?.[0] ?? [];
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.direction)).toEqual(["DEBIT", "CREDIT"]);
    expect(drafts[0]?.amountFen).toBe(12800n);
    expect(drafts[0]?.amountFen).toBe(drafts[1]?.amountFen);
  });
});
