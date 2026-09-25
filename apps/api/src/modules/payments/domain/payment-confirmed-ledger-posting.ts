import { assertBalancedFundEntries } from "../../ledger/domain/funds.js";
import type { FundEntryDirection } from "../../ledger/domain/funds.js";

/**
 * DS-003：微信支付成功确认入账的固定口径。
 * 科目、来源、事件、状态与辅助核算类型的唯一定义点；仓储只引用这里的常量，不得自行硬编码。
 */

/** 统一总账来源：支付单。 */
export const PAYMENT_CONFIRMED_SOURCE_TYPE = "payment_order";
/** 已由微信回调确认的充值事件。 */
export const PAYMENT_CONFIRMED_EVENT_TYPE = "PAYMENT_CONFIRMED";
/** 入账即确认：本任务只处理回调已确认的成功充值。 */
export const PAYMENT_CONFIRMED_STATUS = "CONFIRMED";
/** 两条分录共用的客户辅助核算类型。 */
export const CUSTOMER_AUXILIARY_TYPE = "customer_profile";

/** 借方科目：钱在微信渠道、尚未落到可用资金。 */
export const WECHAT_SETTLEMENT_ASSET_ACCOUNT = {
  code: "WECHAT_SETTLEMENT_ASSET",
  name: "微信渠道待结算资产",
} as const;

/** 贷方科目：客户预先支付的余额是门店的负债。 */
export const CUSTOMER_PREPAID_LIABILITY_ACCOUNT = {
  code: "CUSTOMER_PREPAID_LIABILITY",
  name: "客户预收款",
} as const;

/** 本任务涉及的两个科目码。 */
export type PaymentConfirmedAccountCode =
  | typeof WECHAT_SETTLEMENT_ASSET_ACCOUNT.code
  | typeof CUSTOMER_PREPAID_LIABILITY_ACCOUNT.code;

/** 入参非法（金额不是正整数分）：明确拒绝，不做静默纠正。 */
export class PaymentConfirmedInputError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PaymentConfirmedInputError";
  }
}

/**
 * 资金账户配置错误：当前租户启用的 `WECHAT_SETTLEMENT` 资金账户不是恰好一个。
 * 消息只带数量，不带账户名称、编号或外部参考等敏感信息。
 */
export class WechatSettlementFundAccountConfigurationError extends Error {
  constructor(activeCount: number) {
    super(
      `微信支付确认入账前必须恰好配置一个启用的微信结算资金账户，当前启用数量为 ${activeCount}`,
    );
    this.name = "WechatSettlementFundAccountConfigurationError";
  }
}

export interface PaymentConfirmedPostingInput {
  /** 支付单金额（分），必须为正整数。 */
  amountFen: bigint;
  /** 已由仓储解析出的、当前租户唯一启用的 WECHAT_SETTLEMENT 资金账户 id。 */
  fundAccountId: string;
  /** 支付单 id，作为总账来源 id。 */
  paymentOrderId: string;
  /** 支付单商户单号，写入描述供人工追溯。 */
  paymentOrderOutNo: string;
  /** 客户档案 id，两条分录的辅助核算 id。 */
  customerProfileId: string;
  /** 微信回调给出的支付时间，同时作为发生时间与确认时间。 */
  paidAt: Date;
}

export interface PaymentConfirmedLedgerTransactionDraft {
  sourceType: typeof PAYMENT_CONFIRMED_SOURCE_TYPE;
  sourceId: string;
  eventType: typeof PAYMENT_CONFIRMED_EVENT_TYPE;
  status: typeof PAYMENT_CONFIRMED_STATUS;
  /** 交易锚定的资金账户，用于按资金账户查询总账交易。 */
  fundAccountId: string;
  description: string;
  occurredAt: Date;
  confirmedAt: Date;
}

export interface PaymentConfirmedLedgerEntryDraft {
  accountCode: PaymentConfirmedAccountCode;
  direction: FundEntryDirection;
  amountFen: bigint;
  /** 只有借方（资产）落在资金账户上；贷方是客户负债，不挂资金账户。 */
  fundAccountId: string | null;
  auxiliaryType: typeof CUSTOMER_AUXILIARY_TYPE;
  auxiliaryId: string;
}

export interface PaymentConfirmedLedgerPosting {
  transaction: PaymentConfirmedLedgerTransactionDraft;
  /** 恰好一借一贷，金额同为支付单金额。 */
  entries: readonly [
    PaymentConfirmedLedgerEntryDraft,
    PaymentConfirmedLedgerEntryDraft,
  ];
}

/**
 * 由支付成功事件推导统一总账草稿：借 `WECHAT_SETTLEMENT_ASSET`、贷 `CUSTOMER_PREPAID_LIABILITY`。
 * 纯函数，无 NestJS / Prisma / HTTP / 数据库依赖，只负责口径，不负责取数与落库。
 */
export function buildPaymentConfirmedLedgerPosting(
  input: PaymentConfirmedPostingInput,
): PaymentConfirmedLedgerPosting {
  if (typeof input.amountFen !== "bigint" || input.amountFen <= 0n) {
    throw new PaymentConfirmedInputError(
      `微信支付确认金额必须为大于 0 的整数分，实际收到 ${String(input.amountFen)}`,
    );
  }

  const entries: readonly [
    PaymentConfirmedLedgerEntryDraft,
    PaymentConfirmedLedgerEntryDraft,
  ] = [
    {
      accountCode: WECHAT_SETTLEMENT_ASSET_ACCOUNT.code,
      direction: "DEBIT",
      amountFen: input.amountFen,
      fundAccountId: input.fundAccountId,
      auxiliaryType: CUSTOMER_AUXILIARY_TYPE,
      auxiliaryId: input.customerProfileId,
    },
    {
      accountCode: CUSTOMER_PREPAID_LIABILITY_ACCOUNT.code,
      direction: "CREDIT",
      amountFen: input.amountFen,
      fundAccountId: null,
      auxiliaryType: CUSTOMER_AUXILIARY_TYPE,
      auxiliaryId: input.customerProfileId,
    },
  ];

  // 复用既有守卫：非正金额与借贷不平衡都在这里兜底，避免绕过领域规则直接落库。
  assertBalancedFundEntries(entries);

  return {
    transaction: {
      sourceType: PAYMENT_CONFIRMED_SOURCE_TYPE,
      sourceId: input.paymentOrderId,
      eventType: PAYMENT_CONFIRMED_EVENT_TYPE,
      status: PAYMENT_CONFIRMED_STATUS,
      fundAccountId: input.fundAccountId,
      description: `微信支付充值已确认（支付单 ${input.paymentOrderOutNo}）`,
      occurredAt: input.paidAt,
      confirmedAt: input.paidAt,
    },
    entries,
  };
}
