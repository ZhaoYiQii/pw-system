/**
 * S4-2c：下单所需的仓储端口。
 *
 * 与 `PaymentsRepository`（回调链路）分开：让两个服务的依赖各自最小，
 * 已有回调单测的假实现也不必跟着变形（接口隔离）。
 */

export interface TenantPaymentAccountRecord {
  subMchid: string | null;
  /** APPLYING | PENDING_CONFIRM | ACTIVE | SUSPENDED */
  status: string;
}

export interface PayerIdentityRecord {
  customerProfileId: string;
  /** 服务商公众号下的 openid（sp_openid）；为空表示该客户还没走过微信授权。 */
  spOpenid: string | null;
}

export interface CheckoutRepository {
  findTenantPaymentAccount(
    tenantId: string,
  ): Promise<TenantPaymentAccountRecord | null>;
  findCustomerPayerIdentity(
    tenantId: string,
    customerAccountId: string,
  ): Promise<PayerIdentityRecord | null>;
  createPrepayOrder(input: {
    tenantId: string;
    customerProfileId: string;
    outNo: string;
    amountFen: bigint;
    spMchid: string;
    subMchid: string;
  }): Promise<{ id: string; outNo: string }>;
  attachPrepayId(
    tenantId: string,
    orderId: string,
    prepayId: string,
  ): Promise<void>;
}
