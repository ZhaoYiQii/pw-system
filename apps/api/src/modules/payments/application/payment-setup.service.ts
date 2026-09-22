import type {
  PaymentAccountRecord,
  PaymentSetupRepository,
  RejectDetailItem,
} from "./payment-setup-ports.js";
import type { WechatPayPartnerClient } from "../infrastructure/wechatpay-partner.client.js";
import {
  canAcceptPayment,
  mapApplymentState,
  NEXT_ACTION_TEXT,
  setupSource,
  type PaymentSetupNextAction,
  type PaymentSetupStatus,
} from "../domain/payment-setup.js";
import {
  PaymentSetupInputError,
  WechatPayDisabledError,
} from "../domain/payments.errors.js";

/**
 * S4-5：门店支付进件与开户意愿确认（平台侧）。
 *
 * 这一片**不调提交进件接口**（提交要 30+ 字段 + 敏感字段公钥加密 + 图片上传，单独一片做），
 * 解决的是"门店的支付账户现在是什么状态、下一步该谁做什么"：
 * - 人工绑定：门店已经在服务商后台人工进件时，先把子商户号登记进系统（试运营期最短路径）；
 * - 状态刷新：查微信进件申请单状态 + 开户意愿确认状态，映射成本系统状态并留痕；
 * - 指引：告诉老板"现在该做什么"（提交资料 / 扫码签约 / 等开通 / 已可收款）。
 */

export interface PaymentSetupView {
  /** 库里有没有支付账户记录。 */
  configured: boolean;
  /** 本系统状态（**下单门禁读的就是这个值**）。 */
  status: PaymentSetupStatus;
  nextAction: PaymentSetupNextAction;
  nextActionText: string;
  /** 映射依据（排障用）。 */
  guidance: string;
  /** 能不能收款：与下单门禁同一函数，避免两处口径漂移。 */
  canAcceptPayment: boolean;
  subMchid: string | null;
  subAppid: string | null;
  applyNo: string | null;
  businessCode: string | null;
  providerState: string | null;
  providerStateMsg: string | null;
  authorizeState: string | null;
  rejectDetail: RejectDetailItem[];
  /** 老板扫码签约链接（微信返回，5 分钟/长期有效以官方为准，每次刷新都更新）。 */
  signUrl: string | null;
  source: "WECHAT_APPLYMENT" | "MANUAL_BIND" | null;
  submittedAt: string | null;
  lastSyncedAt: string | null;
}

export class TenantPaymentSetupService {
  constructor(
    private readonly repository: PaymentSetupRepository,
    private readonly client: WechatPayPartnerClient | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 读当前状态：**不需要微信凭证**（未启用支付时后台仍要能看状态与指引）。 */
  async getStatus(tenantId: string): Promise<PaymentSetupView> {
    return toView(await this.repository.findAccount(tenantId));
  }

  /** 人工绑定子商户号（服务商后台已人工进件）。 */
  async bindSubMchid(input: {
    tenantId: string;
    subMchid: string;
    operatorAccountId: string;
  }): Promise<PaymentSetupView> {
    const subMchid = input.subMchid.trim();
    if (!/^[0-9]{6,32}$/.test(subMchid)) {
      throw new PaymentSetupInputError("子商户号应为 6-32 位数字");
    }
    const account = await this.repository.bindSubMchid({
      tenantId: input.tenantId,
      subMchid,
      operatorAccountId: input.operatorAccountId,
    });
    return toView(account);
  }

  /**
   * 刷新：查微信申请单状态 + 开户意愿确认状态 → 映射 → 落库（状态没变就不重复写审计）。
   * 没有微信凭证时**明确 503**，不假装成功（与下单/退款同一口径）。
   */
  async refresh(input: {
    tenantId: string;
    operatorAccountId: string;
  }): Promise<PaymentSetupView> {
    if (!this.client) throw new WechatPayDisabledError();
    const client = this.client;
    const account = await this.repository.findAccount(input.tenantId);
    if (!account) {
      throw new PaymentSetupInputError(
        "该门店还没有支付账户记录：请先提交进件资料或人工绑定子商户号",
      );
    }
    if (!account.applyNo && !account.subMchid) {
      throw new PaymentSetupInputError(
        "还没有申请单号或子商户号，无法向微信查询状态",
      );
    }

    // 申请单状态（有申请单号才查；人工绑定只有子商户号）
    const applyment = account.applyNo
      ? await client.queryApplyment(account.applyNo)
      : null;
    const subMchid = applyment?.subMchid ?? account.subMchid;
    // 开户意愿确认状态（有子商户号才查得到）
    const authorizeState = subMchid
      ? await client.getAuthorizeState(subMchid)
      : null;

    const mapped = mapApplymentState({
      applymentState: applyment?.applymentState ?? account.providerState,
      authorizeState,
      hasSubMchid: Boolean(subMchid),
    });
    const rejectDetail =
      applyment?.auditDetail && applyment.auditDetail.length > 0
        ? applyment.auditDetail
        : null;
    const syncedAt = this.now();
    const { account: updated, changed } =
      await this.repository.applyProviderStatus({
        tenantId: input.tenantId,
        status: mapped.status,
        subMchid,
        providerState: applyment?.applymentState ?? account.providerState,
        providerStateMsg:
          applyment?.applymentStateMsg ?? account.providerStateMsg,
        rejectDetail,
        signUrl: applyment?.signUrl ?? account.signUrl,
        authorizeState,
        syncedAt,
        operatorAccountId: input.operatorAccountId,
        summary: `门店支付状态刷新 → ${mapped.status}（${mapped.reason}）`,
      });
    // changed 只影响是否写审计；返回值一律以库里最新为准
    void changed;
    return toView(updated);
  }
}

/** 账户记录 → 视图。状态以**库里那一列**为准（下单门禁读它），指引由映射函数给。 */
export function toView(account: PaymentAccountRecord | null): PaymentSetupView {
  const empty = mapApplymentState({
    applymentState: null,
    hasSubMchid: false,
  });
  if (!account) {
    return {
      configured: false,
      status: empty.status,
      nextAction: empty.nextAction,
      nextActionText: NEXT_ACTION_TEXT[empty.nextAction],
      guidance: empty.reason,
      canAcceptPayment: false,
      subMchid: null,
      subAppid: null,
      applyNo: null,
      businessCode: null,
      providerState: null,
      providerStateMsg: null,
      authorizeState: null,
      rejectDetail: [],
      signUrl: null,
      source: null,
      submittedAt: null,
      lastSyncedAt: null,
    };
  }
  const mapped = mapApplymentState({
    applymentState: account.providerState,
    authorizeState: account.authorizeState,
    hasSubMchid: Boolean(account.subMchid),
  });
  const status = account.status as PaymentSetupStatus;
  return {
    configured: true,
    status,
    nextAction: mapped.nextAction,
    nextActionText: NEXT_ACTION_TEXT[mapped.nextAction],
    guidance: mapped.reason,
    canAcceptPayment: canAcceptPayment(account.subMchid, account.status),
    subMchid: account.subMchid,
    subAppid: account.subAppid,
    applyNo: account.applyNo,
    businessCode: account.businessCode,
    providerState: account.providerState,
    providerStateMsg: account.providerStateMsg,
    authorizeState: account.authorizeState,
    rejectDetail: normalizeRejectDetail(account.rejectDetail),
    signUrl: account.signUrl,
    source: setupSource({
      applyNo: account.applyNo,
      businessCode: account.businessCode,
      subMchid: account.subMchid,
    }),
    submittedAt: account.submittedAt?.toISOString() ?? null,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
  };
}

function normalizeRejectDetail(value: unknown): RejectDetailItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      field: typeof row.field === "string" ? row.field : null,
      fieldName: typeof row.fieldName === "string" ? row.fieldName : null,
      rejectReason:
        typeof row.rejectReason === "string" ? row.rejectReason : null,
    };
  });
}
