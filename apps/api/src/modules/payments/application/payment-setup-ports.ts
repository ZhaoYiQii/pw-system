/** S4-5：门店支付进件与开户意愿确认的仓储端口（接口隔离，便于假实现单测）。 */

export interface PaymentAccountRecord {
  status: string;
  subMchid: string | null;
  subAppid: string | null;
  applyNo: string | null;
  businessCode: string | null;
  providerState: string | null;
  providerStateMsg: string | null;
  /** 开户意愿确认状态（AUTHORIZE_STATE_*）。 */
  authorizeState: string | null;
  rejectDetail: unknown;
  signUrl: string | null;
  submittedAt: Date | null;
  lastSyncedAt: Date | null;
}

/** 驳回原因一项（微信 `audit_detail` 的字段名已转成驼峰，落库/出参都用这个形状）。 */
export type RejectDetailItem = {
  field: string | null;
  fieldName: string | null;
  rejectReason: string | null;
};

export interface PaymentSetupRepository {
  findAccount(tenantId: string): Promise<PaymentAccountRecord | null>;
  /**
   * 人工绑定子商户号（门店已在服务商后台人工进件时用）。
   * 没有账户记录就建一条；已有 ACTIVE 不降级。
   */
  bindSubMchid(input: {
    tenantId: string;
    subMchid: string;
    operatorAccountId: string;
  }): Promise<PaymentAccountRecord>;
  /**
   * 落"已提交进件"：业务申请编号 + 微信申请单号 + 提交时间，状态转 APPLYING 并写审计。
   * **只在微信返回 applyment_id 之后调用**——失败时库里不该出现"看起来提交过"的痕。
   */
  recordSubmittedApplyment(input: {
    tenantId: string;
    businessCode: string;
    applyNo: string;
    submittedAt: Date;
    operatorAccountId: string;
    summary: string;
  }): Promise<PaymentAccountRecord>;
  /**
   * 落微信侧查询结果：状态、子商户号、签约链接、驳回详情、同步时间；
   * `changed=false` 表示与库里一致（不重复写审计）。
   */
  applyProviderStatus(input: {
    tenantId: string;
    status: string;
    subMchid: string | null;
    providerState: string | null;
    providerStateMsg: string | null;
    authorizeState: string | null;
    rejectDetail: RejectDetailItem[] | null;
    signUrl: string | null;
    syncedAt: Date;
    operatorAccountId: string;
    summary: string;
  }): Promise<{ account: PaymentAccountRecord; changed: boolean }>;
}
