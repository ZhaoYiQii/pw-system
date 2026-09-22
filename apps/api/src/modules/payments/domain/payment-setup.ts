/**
 * S4-5：门店支付进件与开户意愿确认的**纯口径**（不碰 IO，可零凭证单测）。
 *
 * 官方口径（2026-09-23 取 `.md` 原文核对，来源见每条注释）：
 * - 进件申请单状态 `applyment_state` 共 8 种（partner/4012697052）；
 * - `sub_mchid` 只有「待签约 / 开通权限中 / 已完成」三种状态才返回；
 * - 开户意愿确认状态 `authorize_state`：`AUTHORIZE_STATE_UNAUTHORIZED`（未完成实名认证）
 *   / `AUTHORIZE_STATE_AUTHORIZED`（已完成）（partner/4012467549）；
 * - 官方原文：开户意愿确认是「商户正常使用支付、结算等功能的必要前提」。
 *
 * 两条设计红线：
 * 1. **绝不因为"审核通过"就当成可收款**——只有 `sub_mchid` 存在且开户意愿确认完成（AUTHORIZED）
 *    才映射成 `ACTIVE`；其余一律不许 ACTIVE（与下单门禁同一判据）。
 * 2. 认不出的状态**fail-closed**：映射成 `SUSPENDED` + 人工介入，不猜、不放行。
 */

export type PaymentSetupStatus =
  "APPLYING" | "PENDING_CONFIRM" | "ACTIVE" | "SUSPENDED";

export type PaymentSetupNextAction =
  | "SUBMIT_INTAKE"
  | "WAIT_AUDIT"
  | "FIX_AND_RESUBMIT"
  | "SCAN_TO_SIGN"
  | "WAIT_ACTIVATION"
  | "READY"
  | "CONTACT_SUPPORT";

export const AUTHORIZE_STATE_AUTHORIZED = "AUTHORIZE_STATE_AUTHORIZED";
export const AUTHORIZE_STATE_UNAUTHORIZED = "AUTHORIZE_STATE_UNAUTHORIZED";

/** 下一步指引的中文说明（前端直接展示，避免文案散落）。 */
export const NEXT_ACTION_TEXT: Record<PaymentSetupNextAction, string> = {
  SUBMIT_INTAKE: "还没有提交进件资料，先在服务商后台或本页提交。",
  WAIT_AUDIT: "微信审核中，通常几分钟到 1 个工作日，审核通过后会自动通知。",
  FIX_AND_RESUBMIT: "资料被驳回：按驳回原因改完用同一个申请单编号重提。",
  SCAN_TO_SIGN: "请门店老板用微信扫码，完成账户验证与签约（开户意愿确认）。",
  WAIT_ACTIVATION: "已签约，微信正在开通支付权限，请稍等后点刷新。",
  READY: "已可收款：客户在 H5 充值会直接进门店自己的商户号。",
  CONTACT_SUPPORT: "状态异常，请把本页信息发给平台对接人核查。",
};

export interface ApplymentStatusInput {
  /** 微信侧原始申请单状态；null = 没有申请单（例如人工进件后只绑了子商户号）。 */
  applymentState: string | null;
  /** 开户意愿确认状态；null = 还没查过（例如没有子商户号）。 */
  authorizeState?: string | null;
  /** 当前是否已有子商户号（人工绑定或微信返回）。 */
  hasSubMchid: boolean;
}

export interface ApplymentMapping {
  status: PaymentSetupStatus;
  nextAction: PaymentSetupNextAction;
  /** 给用户看的依据（排障时能说清"为什么是这个状态"）。 */
  reason: string;
}

/** 微信 8 种申请单状态的映射表（数值全部来自 partner/4012697052 原文）。 */
export function mapApplymentState(
  input: ApplymentStatusInput,
): ApplymentMapping {
  const state = input.applymentState;
  if (state === null) {
    // 没有申请单：可能是人工进件后绑了子商户号，也可能是还没开工
    return input.hasSubMchid
      ? {
          status: "PENDING_CONFIRM",
          nextAction: "SCAN_TO_SIGN",
          reason: "已登记子商户号但未同步到微信，请点刷新核对签约与实名状态",
        }
      : {
          status: "APPLYING",
          nextAction: "SUBMIT_INTAKE",
          reason: "还没有进件申请单",
        };
  }
  switch (state) {
    case "APPLYMENT_STATE_EDITTING":
      return {
        status: "APPLYING",
        nextAction: "FIX_AND_RESUBMIT",
        reason: "微信侧申请单处于编辑中（提交出错），需要重新提交",
      };
    case "APPLYMENT_STATE_AUDITING":
      return {
        status: "APPLYING",
        nextAction: "WAIT_AUDIT",
        reason: "进件资料审核中",
      };
    case "APPLYMENT_STATE_REJECTED":
      return {
        status: "APPLYING",
        nextAction: "FIX_AND_RESUBMIT",
        reason: "进件资料被驳回",
      };
    case "APPLYMENT_STATE_TO_BE_CONFIRMED":
      return {
        status: "PENDING_CONFIRM",
        nextAction: "SCAN_TO_SIGN",
        reason: "待超级管理员完成账户验证",
      };
    case "APPLYMENT_STATE_TO_BE_SIGNED":
      return {
        status: "PENDING_CONFIRM",
        nextAction: "SCAN_TO_SIGN",
        reason: "待超级管理员完成签约（开户意愿确认）",
      };
    case "APPLYMENT_STATE_SIGNING":
      return {
        status: "PENDING_CONFIRM",
        nextAction: "WAIT_ACTIVATION",
        reason: "已签约，微信正在开通权限",
      };
    case "APPLYMENT_STATE_FINISHED":
      if (!input.hasSubMchid) {
        // 官方：FINISHED 才返回 sub_mchid。拿不到子商户号就别宣称可收款。
        return {
          status: "PENDING_CONFIRM",
          nextAction: "CONTACT_SUPPORT",
          reason: "进件显示已完成但没拿到子商户号，请人工核查",
        };
      }
      if (input.authorizeState === AUTHORIZE_STATE_AUTHORIZED) {
        return {
          status: "ACTIVE",
          nextAction: "READY",
          reason: "进件完成且开户意愿确认已通过",
        };
      }
      return {
        status: "PENDING_CONFIRM",
        nextAction: "SCAN_TO_SIGN",
        reason:
          input.authorizeState === AUTHORIZE_STATE_UNAUTHORIZED
            ? "进件完成，但开户意愿确认显示未授权（实名认证未完成）"
            : "进件完成，但开户意愿确认状态未知，请刷新或扫码完成签约",
      };
    case "APPLYMENT_STATE_CANCELED":
      return {
        status: "SUSPENDED",
        nextAction: "CONTACT_SUPPORT",
        reason: "申请单已作废",
      };
    default:
      return {
        status: "SUSPENDED",
        nextAction: "CONTACT_SUPPORT",
        reason: `未知的申请单状态：${state}（已按不通过处理）`,
      };
  }
}

/** 能不能收款：与下单门禁**同一判据**（子商户号 + ACTIVE），只有这一处定义。 */
export function canAcceptPayment(
  subMchid: string | null,
  status: string | null,
): boolean {
  return Boolean(subMchid) && status === "ACTIVE";
}

/** 进件资料谁来提交：从库里已有的字段推断（只用于展示，不影响门禁）。 */
export function setupSource(input: {
  applyNo: string | null;
  businessCode: string | null;
  subMchid: string | null;
}): "WECHAT_APPLYMENT" | "MANUAL_BIND" | null {
  if (input.applyNo || input.businessCode) return "WECHAT_APPLYMENT";
  if (input.subMchid) return "MANUAL_BIND";
  return null;
}
