import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./funds.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./funds.js")>();
  return {
    ...actual,
    assertBalancedFundEntries: vi.fn(actual.assertBalancedFundEntries),
  };
});

vi.mock("./ledger-transaction-no.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./ledger-transaction-no.js")>();
  return {
    ...actual,
    buildLedgerTransactionNo: vi.fn(actual.buildLedgerTransactionNo),
  };
});

import { assertBalancedFundEntries } from "./funds.js";
import { buildLedgerTransactionNo } from "./ledger-transaction-no.js";
import {
  PLAYER_PAYABLE_ACCOUNT,
  PLAYER_PAYOUT_CONFIRMED_EVENT_TYPE,
  PLAYER_PAYOUT_CONFIRMED_SOURCE_TYPE,
  PLAYER_PAYOUT_CONFIRMED_STATUS,
  PLAYER_PAYOUT_NOTE_MAX_LENGTH,
  PlayerPayoutConfirmedConflictError,
  PlayerPayoutConfirmedInputError,
  SETTLEMENT_BATCH_AUXILIARY_TYPE,
  SETTLEMENT_FUND_ASSET_ACCOUNT,
  buildManualPaymentNote,
  buildPlayerPayoutConfirmedLedgerPosting,
  normalizePlayerPayoutRequest,
  toSettlementBatchStatus,
} from "./player-payout-confirmed-ledger-posting.js";
import type { PlayerPayoutConfirmedPostingInput } from "./player-payout-confirmed-ledger-posting.js";

const OCCURRED_AT = new Date("2026-09-24T12:00:00.000Z");
const BATCH_ID = "11111111-1111-1111-1111-111111111111";
const FUND_ACCOUNT_ID = "22222222-2222-2222-2222-222222222222";
const ACTOR_ID = "33333333-3333-3333-3333-333333333333";

function validInput(
  overrides: Partial<PlayerPayoutConfirmedPostingInput> = {},
): PlayerPayoutConfirmedPostingInput {
  return {
    batchId: BATCH_ID,
    fundAccountId: FUND_ACCOUNT_ID,
    amountFen: 18800n,
    occurredAt: OCCURRED_AT,
    actorId: ACTOR_ID,
    ...overrides,
  };
}

describe("陪玩实际付款确认总账口径（DS-006）", () => {
  beforeEach(() => {
    vi.mocked(assertBalancedFundEntries).mockClear();
    vi.mocked(buildLedgerTransactionNo).mockClear();
  });

  it("生成固定来源、事件、状态和确认时间的交易草稿", () => {
    const posting = buildPlayerPayoutConfirmedLedgerPosting(validInput());

    expect(posting.transaction.sourceType).toBe(
      PLAYER_PAYOUT_CONFIRMED_SOURCE_TYPE,
    );
    expect(posting.transaction.sourceType).toBe("settlement_batch");
    expect(posting.transaction.sourceId).toBe(BATCH_ID);
    expect(posting.transaction.eventType).toBe(
      PLAYER_PAYOUT_CONFIRMED_EVENT_TYPE,
    );
    expect(posting.transaction.eventType).toBe("PLAYER_PAYOUT_CONFIRMED");
    expect(posting.transaction.status).toBe(PLAYER_PAYOUT_CONFIRMED_STATUS);
    expect(posting.transaction.status).toBe("CONFIRMED");
    expect(posting.transaction.fundAccountId).toBe(FUND_ACCOUNT_ID);
    expect(posting.transaction.createdBy).toBe(ACTOR_ID);
    expect(posting.transaction.confirmedBy).toBe(ACTOR_ID);
    expect(posting.transaction.occurredAt).toBe(OCCURRED_AT);
    expect(posting.transaction.confirmedAt).toBe(OCCURRED_AT);
  });

  it("借应付陪玩款、贷结算付款资金资产，且只有贷方挂资金账户", () => {
    const [debit, credit] =
      buildPlayerPayoutConfirmedLedgerPosting(validInput()).entries;

    expect(debit.accountCode).toBe(PLAYER_PAYABLE_ACCOUNT.code);
    expect(debit.accountCode).toBe("PLAYER_PAYABLE");
    expect(debit.direction).toBe("DEBIT");
    expect(debit.fundAccountId).toBeNull();

    expect(credit.accountCode).toBe(SETTLEMENT_FUND_ASSET_ACCOUNT.code);
    expect(credit.accountCode).toBe("SETTLEMENT_FUND_ASSET");
    expect(credit.direction).toBe("CREDIT");
    expect(credit.fundAccountId).toBe(FUND_ACCOUNT_ID);
  });

  it("两条分录都按批次辅助核算，金额相等且大于零", () => {
    const posting = buildPlayerPayoutConfirmedLedgerPosting(validInput());

    expect(posting.entries).toHaveLength(2);
    for (const entry of posting.entries) {
      expect(entry.amountFen).toBe(18800n);
      expect(entry.amountFen).toBeGreaterThan(0n);
      expect(entry.auxiliaryType).toBe(SETTLEMENT_BATCH_AUXILIARY_TYPE);
      expect(entry.auxiliaryType).toBe("settlement_batch");
      expect(entry.auxiliaryId).toBe(BATCH_ID);
    }
  });

  it("拒绝零或负金额、空标识和无效发生时间", () => {
    const invalidInputs: PlayerPayoutConfirmedPostingInput[] = [
      validInput({ amountFen: 0n }),
      validInput({ amountFen: -1n }),
      validInput({ batchId: "   " }),
      validInput({ fundAccountId: "" }),
      validInput({ actorId: " " }),
      validInput({ occurredAt: new Date(Number.NaN) }),
    ];

    for (const input of invalidInputs) {
      expect(() => buildPlayerPayoutConfirmedLedgerPosting(input)).toThrow(
        PlayerPayoutConfirmedInputError,
      );
    }
  });

  it("生成交易号并复用既有借贷平衡守卫", () => {
    const posting = buildPlayerPayoutConfirmedLedgerPosting(validInput());

    expect(buildLedgerTransactionNo).toHaveBeenCalledTimes(1);
    expect(posting.transaction.txNo).toMatch(/^LT[A-F0-9]{32}$/);
    expect(assertBalancedFundEntries).toHaveBeenCalledTimes(1);
    const entries = vi.mocked(assertBalancedFundEntries).mock.calls[0]?.[0];
    expect(entries).toEqual(posting.entries);
  });

  it("描述带批次号与幂等键供人工追溯，缺失时退回批次 id", () => {
    const labeled = buildPlayerPayoutConfirmedLedgerPosting(
      validInput({ batchNo: "S1234ABCD", idempotencyKey: "payout-0001" }),
    );
    expect(labeled.transaction.description).toContain("S1234ABCD");
    expect(labeled.transaction.description).toContain("payout-0001");

    const bare = buildPlayerPayoutConfirmedLedgerPosting(validInput());
    expect(bare.transaction.description).toContain(BATCH_ID);
  });

  it("批次号或幂等键「给了但不合法」时拒绝，不回退成静默兜底", () => {
    expect(() =>
      buildPlayerPayoutConfirmedLedgerPosting(validInput({ batchNo: "   " })),
    ).toThrow(PlayerPayoutConfirmedInputError);
    expect(() =>
      buildPlayerPayoutConfirmedLedgerPosting(
        validInput({ idempotencyKey: "bad key" }),
      ),
    ).toThrow(PlayerPayoutConfirmedInputError);
  });

  it("金额不是 bigint 时也拒绝（运行时不依赖 TypeScript 标注）", () => {
    // 本用例要覆盖的正是「静态类型与运行时值不一致」，所以必须绕过类型检查
    // （双重断言）；改成类型合法的数字就测不到这条防线了。
    const misTyped = {
      ...validInput(),
      amountFen: 18800,
    } as unknown as PlayerPayoutConfirmedPostingInput;
    expect(() => buildPlayerPayoutConfirmedLedgerPosting(misTyped)).toThrow(
      PlayerPayoutConfirmedInputError,
    );
  });
});

describe("付款请求边界校验（进入仓储之前，DS-006）", () => {
  function body(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      fundAccountId: FUND_ACCOUNT_ID,
      evidenceRef: "BANK-20260924-0001",
      occurredAt: "2026-09-24T12:00:00.000Z",
      idempotencyKey: "payout-20260924-0001",
      ...overrides,
    };
  }

  it("合法请求体裁剪后放行，备注缺失或空白按 null", () => {
    const normalized = normalizePlayerPayoutRequest(
      body({
        fundAccountId: ` ${FUND_ACCOUNT_ID} `,
        evidenceRef: " bank-1 ",
        idempotencyKey: " k-1 ",
        note: "  已付  ",
      }),
      BATCH_ID,
    );

    expect(normalized.batchId).toBe(BATCH_ID);
    expect(normalized.fundAccountId).toBe(FUND_ACCOUNT_ID);
    expect(normalized.evidenceRef).toBe("bank-1");
    expect(normalized.idempotencyKey).toBe("k-1");
    expect(normalized.note).toBe("已付");
    expect(normalized.occurredAt.toISOString()).toBe(
      "2026-09-24T12:00:00.000Z",
    );

    expect(
      normalizePlayerPayoutRequest(body({ note: "   " }), BATCH_ID).note,
    ).toBeNull();
    expect(normalizePlayerPayoutRequest(body(), BATCH_ID).note).toBeNull();
  });

  it("批次 id 只认路径参数，请求体里的 batchId 被忽略", () => {
    const normalized = normalizePlayerPayoutRequest(
      body({ batchId: "99999999-9999-9999-9999-999999999999" }),
      BATCH_ID,
    );
    expect(normalized.batchId).toBe(BATCH_ID);
  });

  it("请求体不是 JSON 对象时拒绝（空请求体不得登记线下支付）", () => {
    for (const raw of [undefined, null, "", "{}", [], ["a"]]) {
      expect(() => normalizePlayerPayoutRequest(raw, BATCH_ID)).toThrow(
        PlayerPayoutConfirmedInputError,
      );
    }
  });

  it("付款凭证号：空、超长、非安全字符一律拒绝，边界长度放行", () => {
    for (const evidenceRef of [
      "",
      "   ",
      "has space",
      "凭证书",
      "a/b",
      "a.b",
      "ok\nbad",
      "x".repeat(65),
    ]) {
      expect(() =>
        normalizePlayerPayoutRequest(body({ evidenceRef }), BATCH_ID),
      ).toThrow(PlayerPayoutConfirmedInputError);
    }

    expect(
      normalizePlayerPayoutRequest(body({ evidenceRef: "a_b-c" }), BATCH_ID)
        .evidenceRef,
    ).toBe("a_b-c");
    const maxLength = "A".repeat(64);
    expect(
      normalizePlayerPayoutRequest(body({ evidenceRef: maxLength }), BATCH_ID)
        .evidenceRef,
    ).toBe(maxLength);
  });

  it("幂等键与两个 uuid 标识的非法值都在进入仓储前拒绝", () => {
    for (const idempotencyKey of [
      "",
      " ",
      "x".repeat(65),
      "key with space",
      "键",
    ]) {
      expect(() =>
        normalizePlayerPayoutRequest(body({ idempotencyKey }), BATCH_ID),
      ).toThrow(PlayerPayoutConfirmedInputError);
    }
    for (const fundAccountId of [
      "",
      "not-a-uuid",
      "11111111-1111-1111-1111-1111111111",
    ]) {
      expect(() =>
        normalizePlayerPayoutRequest(body({ fundAccountId }), BATCH_ID),
      ).toThrow(PlayerPayoutConfirmedInputError);
    }
    expect(() => normalizePlayerPayoutRequest(body(), "not-a-uuid")).toThrow(
      PlayerPayoutConfirmedInputError,
    );
  });

  it("实际付款时间：只接受带时区的 ISO 8601，无效日期与滚动日期都拒绝", () => {
    for (const occurredAt of [
      "",
      "2026-09-24",
      "2026/09/24 12:00:00",
      "2026-09-24T12:00:00",
      "2026-02-31T00:00:00.000Z",
      "2026-13-01T00:00:00.000Z",
      // `new Date("2026-09-24T24:00:00Z")` 是合法的、且会滚到次日：记账时间被静默改动，
      // 必须在这里就拒绝，而不是让 JS 替我们「纠正」。
      "2026-09-24T24:00:00Z",
      "2026-09-24T12:60:00Z",
      "2026-09-24T20:00:00+08",
      "not-a-time",
      new Date(Number.NaN),
    ]) {
      expect(() =>
        normalizePlayerPayoutRequest(body({ occurredAt }), BATCH_ID),
      ).toThrow(PlayerPayoutConfirmedInputError);
    }

    expect(
      normalizePlayerPayoutRequest(
        body({ occurredAt: "2026-09-24T20:00:00+08:00" }),
        BATCH_ID,
      ).occurredAt.toISOString(),
    ).toBe("2026-09-24T12:00:00.000Z");
    expect(
      normalizePlayerPayoutRequest(
        body({ occurredAt: "2026-09-24T12:00:00Z" }),
        BATCH_ID,
      ).occurredAt.toISOString(),
    ).toBe("2026-09-24T12:00:00.000Z");
    // 客户端库常见的两种等价写法：小时偏移不带冒号、小数秒超过毫秒。都不该被误拒
    // （后者由 `Date` 截断到毫秒，日期不变）。
    expect(
      normalizePlayerPayoutRequest(
        body({ occurredAt: "2026-09-24T20:00:00+0800" }),
        BATCH_ID,
      ).occurredAt.toISOString(),
    ).toBe("2026-09-24T12:00:00.000Z");
    expect(
      normalizePlayerPayoutRequest(
        body({ occurredAt: "2026-09-24T12:00:00.123456Z" }),
        BATCH_ID,
      ).occurredAt.toISOString(),
    ).toBe("2026-09-24T12:00:00.123Z");
  });

  it("备注：超长与非字符串拒绝，恰为上限放行", () => {
    const atLimit = "备".repeat(PLAYER_PAYOUT_NOTE_MAX_LENGTH);
    expect(
      normalizePlayerPayoutRequest(body({ note: atLimit }), BATCH_ID).note,
    ).toHaveLength(PLAYER_PAYOUT_NOTE_MAX_LENGTH);

    for (const note of [`${atLimit}备`, 123, {}]) {
      expect(() =>
        normalizePlayerPayoutRequest(body({ note }), BATCH_ID),
      ).toThrow(PlayerPayoutConfirmedInputError);
    }
  });
});

describe("付款记录备注的安全组合（DS-006）", () => {
  it("只放已校验的凭证号，凭证号非法直接拒绝", () => {
    expect(buildManualPaymentNote("BANK-1", null)).toBe("凭证 BANK-1");
    expect(() => buildManualPaymentNote("bad ref", null)).toThrow(
      PlayerPayoutConfirmedInputError,
    );
    expect(() => buildManualPaymentNote("凭证号", "已付")).toThrow(
      PlayerPayoutConfirmedInputError,
    );
  });

  it("凭证号不是字符串时拒绝，不会把 undefined 写进付款记录", () => {
    // 运行时可能拿到缺失字段（JS 调用方、反序列化结果），所以必须绕过类型标注；
    // `RegExp.test(undefined)` 会经字符串强制转换恰好通过正则，把「凭证 undefined」
    // 静默写进付款记录，正是这条防线要挡住的。
    expect(() =>
      buildManualPaymentNote(undefined as unknown as string, null),
    ).toThrow(PlayerPayoutConfirmedInputError);
    expect(() =>
      buildManualPaymentNote(123 as unknown as string, null),
    ).toThrow(PlayerPayoutConfirmedInputError);
  });

  it("备注里的控制字符与换行压成单空格，不留下多行内容", () => {
    const note = buildManualPaymentNote(
      "BANK-1",
      `已付\n备注${String.fromCharCode(0)}张三`,
    );
    expect(note).toBe("凭证 BANK-1；备注 已付 备注 张三");
    expect(note).not.toContain("\n");
    expect(buildManualPaymentNote("BANK-1", "第一行\n第二行")).toBe(
      "凭证 BANK-1；备注 第一行 第二行",
    );
    expect(buildManualPaymentNote("BANK-1", "   ")).toBe("凭证 BANK-1");
  });
});

describe("批次状态收窄（DS-006）", () => {
  it("已知状态原样返回，未知状态拒绝付款", () => {
    expect(toSettlementBatchStatus("APPROVED")).toBe("APPROVED");
    expect(toSettlementBatchStatus("PAID")).toBe("PAID");
    expect(() => toSettlementBatchStatus("BOGUS")).toThrow(
      PlayerPayoutConfirmedConflictError,
    );
  });
});
