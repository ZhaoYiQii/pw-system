import { assertBalancedFundEntries } from "../../ledger/domain/funds.js";
import type { FundEntryDirection } from "../../ledger/domain/funds.js";
import {
  CUSTOMER_AUXILIARY_TYPE,
  CUSTOMER_PREPAID_LIABILITY_ACCOUNT,
  WECHAT_SETTLEMENT_ASSET_ACCOUNT,
} from "./payment-confirmed-ledger-posting.js";
import type { PaymentConfirmedAccountCode } from "./payment-confirmed-ledger-posting.js";
import { assertRefundStatusTransition } from "./refund-confirmation-state.js";
import type { RefundStatus } from "./refund-confirmation-state.js";

/**
 * DS-005：退款确认的资金口径（纯领域规则，无 NestJS / Prisma / HTTP / 数据库依赖）。
 *
 * 与 DS-003 支付入账**方向严格相反**：
 * - 支付入账：借 `WECHAT_SETTLEMENT_ASSET`（钱进微信渠道）、贷 `CUSTOMER_PREPAID_LIABILITY`（欠客户更多）；
 * - 退款确认：借 `CUSTOMER_PREPAID_LIABILITY`（不再欠客户）、贷 `WECHAT_SETTLEMENT_ASSET`（钱从渠道流出）。
 *
 * 本模块只定义"怎么记"，不取数、不落库、不做任何幂等或状态判断——
 * 状态守卫由 DS-004 的状态机负责，落库与事务由仓储负责。
 */

/** 统一总账来源：退款单。 */
export const REFUND_CONFIRMED_SOURCE_TYPE = "payment_refund";
/** 门店实际退款、财务确认后记录的冲销事件。 */
export const REFUND_CONFIRMED_EVENT_TYPE = "REFUND_CONFIRMED";
/** 冲销总账交易的状态：确认即生效。 */
export const REFUND_CONFIRMED_STATUS = "CONFIRMED";

/**
 * 退款单可被确认的起始状态。`satisfies` 让它与 DS-004 的状态联合类型保持编译期联动：
 * 若状态机将来改名或去掉该状态，这里会直接编译报错，而不是静默写进一个不存在的状态。
 */
export const REFUND_CONFIRMABLE_STATUS =
  "PENDING_CONFIRMATION" satisfies RefundStatus;

/** 确认成功后落到 `payment_refunds.status` 的值；只有它代表钱**已经**退回客户。 */
export const REFUND_SUCCEEDED_STATUS = "SUCCEEDED" satisfies RefundStatus;

/**
 * 占用退款额度的状态：**待确认 + 已确认**。
 *
 * 为什么待确认也要占用：退款申请一旦登记，额度就被它占住了。否则同一张支付单可以开出
 * 多张"待确认"申请，合计金额超过原支付金额，等它们逐一确认时才发现超退——那时候钱已经出去了。
 * 被拒（REJECTED）与撤销（CANCELLED）不占用，额度自动释放。
 */
export const REFUND_OCCUPYING_STATUSES: readonly RefundStatus[] = Object.freeze(
  [REFUND_CONFIRMABLE_STATUS, REFUND_SUCCEEDED_STATUS],
);

/** 入参非法（金额不是正整数分）：明确拒绝，不做静默纠正。 */
export class RefundConfirmedInputError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "RefundConfirmedInputError";
  }
}

/**
 * 找不到原支付成功总账交易（或它没挂资金账户）→ 无法确定钱从哪个账户流出，整笔回滚。
 * 消息只带退款单号（业务单号，非客户信息），便于财务按单核对。
 */
export class OriginalPaymentPostingMissingError extends Error {
  constructor(outRefundNo: string) {
    super(
      `退款确认需要原支付成功总账交易及其资金账户，未能定位（退款单 ${outRefundNo}）；请先核对该支付单是否已入账`,
    );
    this.name = "OriginalPaymentPostingMissingError";
  }
}

export interface RefundConfirmedPostingInput {
  /** 本次确认的退款金额（分），必须为正整数。 */
  amountFen: bigint;
  /** 原支付成功总账交易上的资金账户 id（钱从它流出）。 */
  fundAccountId: string;
  /** 退款单 id，作为总账来源 id。 */
  refundId: string;
  /** 退款单商户号，写入描述供人工追溯。 */
  outRefundNo: string;
  /** 客户档案 id，两条分录的辅助核算 id。 */
  customerProfileId: string;
  /** 本次财务确认时间，同时作为发生时间与确认时间。 */
  confirmedAt: Date;
}

export interface RefundConfirmedLedgerTransactionDraft {
  sourceType: typeof REFUND_CONFIRMED_SOURCE_TYPE;
  sourceId: string;
  eventType: typeof REFUND_CONFIRMED_EVENT_TYPE;
  status: typeof REFUND_CONFIRMED_STATUS;
  /** 交易锚定的资金账户（原支付资金账户），用于按资金账户查询总账交易。 */
  fundAccountId: string;
  description: string;
  occurredAt: Date;
  confirmedAt: Date;
}

export interface RefundConfirmedLedgerEntryDraft {
  accountCode: PaymentConfirmedAccountCode;
  direction: FundEntryDirection;
  amountFen: bigint;
  /** 只有贷方（资产）落在资金账户上；借方是客户负债减少，不挂资金账户。 */
  fundAccountId: string | null;
  auxiliaryType: typeof CUSTOMER_AUXILIARY_TYPE;
  auxiliaryId: string;
}

export interface RefundConfirmedLedgerPosting {
  transaction: RefundConfirmedLedgerTransactionDraft;
  /** 恰好一借一贷，金额同为本次退款金额。 */
  entries: readonly [
    RefundConfirmedLedgerEntryDraft,
    RefundConfirmedLedgerEntryDraft,
  ];
}

/**
 * 由"退款已确认"事实推导统一总账冲销草稿：借 `CUSTOMER_PREPAID_LIABILITY`、贷 `WECHAT_SETTLEMENT_ASSET`。
 * 纯函数，只负责口径，不负责取数与落库。
 */
export function buildRefundConfirmedLedgerPosting(
  input: RefundConfirmedPostingInput,
): RefundConfirmedLedgerPosting {
  if (typeof input.amountFen !== "bigint" || input.amountFen <= 0n) {
    throw new RefundConfirmedInputError(
      `退款确认金额必须为大于 0 的整数分，实际收到 ${String(input.amountFen)}`,
    );
  }

  const entries: readonly [
    RefundConfirmedLedgerEntryDraft,
    RefundConfirmedLedgerEntryDraft,
  ] = [
    {
      accountCode: CUSTOMER_PREPAID_LIABILITY_ACCOUNT.code,
      direction: "DEBIT",
      amountFen: input.amountFen,
      fundAccountId: null,
      auxiliaryType: CUSTOMER_AUXILIARY_TYPE,
      auxiliaryId: input.customerProfileId,
    },
    {
      accountCode: WECHAT_SETTLEMENT_ASSET_ACCOUNT.code,
      direction: "CREDIT",
      amountFen: input.amountFen,
      fundAccountId: input.fundAccountId,
      auxiliaryType: CUSTOMER_AUXILIARY_TYPE,
      auxiliaryId: input.customerProfileId,
    },
  ];

  // 复用既有守卫：非正金额与借贷不平衡都在这里兜底，避免绕过领域规则直接落库。
  assertBalancedFundEntries(entries);

  return {
    transaction: {
      sourceType: REFUND_CONFIRMED_SOURCE_TYPE,
      sourceId: input.refundId,
      eventType: REFUND_CONFIRMED_EVENT_TYPE,
      status: REFUND_CONFIRMED_STATUS,
      fundAccountId: input.fundAccountId,
      description: `人工退款已确认（退款单 ${input.outRefundNo}）`,
      occurredAt: input.confirmedAt,
      confirmedAt: input.confirmedAt,
    },
    entries,
  };
}

/**
 * 断言"退款单当前状态可以确认"：把 DS-004 的状态机包一层，
 * 让资金路径只依赖一个具名口径，避免各处自行拼 from/to 或漏判。
 *
 * 参数是**数据库里的自由文本状态**，因此这里必须做一次类型收窄；真正的校验在
 * `assertRefundStatusTransition` 内部按运行时允许状态逐项比对，未知状态同样会被拒绝。
 * 非法（终态、重复确认、未知状态）一律抛 `RefundStatusTransitionError`。
 */
export function assertRefundConfirmable(currentStatus: string): void {
  assertRefundStatusTransition(
    currentStatus as RefundStatus,
    REFUND_SUCCEEDED_STATUS,
  );
}
