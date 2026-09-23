import type {
  PaymentLedgerRepository,
  PaymentLedgerRow,
} from "./payment-ledger-ports.js";
import { PaymentLedgerInputError } from "../domain/payments.errors.js";

/**
 * S4-7：门店支付台账（客户充值/支付的支付单列表）。
 *
 * 口径由后端一处定死，前端不再自己判断：
 * - 过滤状态只认 `payment_orders.status` 的 CHECK 约束里的三个值（别的值直接 400，不静默忽略）；
 * - `limit` 有服务端上限——台账是给门店看最近流水的，不提供无限翻页；
 * - **可退判据与人工退款登记同一口径**（已支付 + 还有没退完的钱），避免台账写"可退"、
 *   点进去却被后端 409 挡回来这种两处口径漂移。
 */

/** 与 `payment_orders` 的 `CHECK (status IN ...)` 完全一致。 */
export const PAYMENT_LEDGER_STATUSES = [
  "PENDING",
  "SUCCESS",
  "FAILED",
] as const;

export const PAYMENT_LEDGER_DEFAULT_LIMIT = 50;
export const PAYMENT_LEDGER_MAX_LIMIT = 200;

export interface PaymentLedgerRowView {
  id: string;
  outNo: string;
  amountFen: string;
  refundedFen: string;
  /** 还能退多少（分）；已全额退为 `"0"`。 */
  refundableFen: string;
  canRefund: boolean;
  status: string;
  customerProfileId: string;
  customerName: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface PaymentLedgerView {
  rows: PaymentLedgerRowView[];
  limit: number;
  status: string | null;
}

export class TenantPaymentLedgerService {
  constructor(private readonly repository: PaymentLedgerRepository) {}

  async list(input: {
    tenantId: string;
    status?: string;
    limit?: string;
  }): Promise<PaymentLedgerView> {
    const status = parseLedgerStatus(input.status);
    const limit = parseLedgerLimit(input.limit);
    const rows = await this.repository.listOrders({
      tenantId: input.tenantId,
      ...(status ? { status } : {}),
      limit,
    });
    return { rows: rows.map(toLedgerRowView), limit, status };
  }
}

/** 空串/未传 = 不过滤；认不出的状态**报错**而不是当"全部"处理（否则筛选会静默失效）。 */
export function parseLedgerStatus(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (!(PAYMENT_LEDGER_STATUSES as readonly string[]).includes(value)) {
    throw new PaymentLedgerInputError(
      `status 只能是 ${PAYMENT_LEDGER_STATUSES.join(" / ")}`,
    );
  }
  return value;
}

export function parseLedgerLimit(raw: string | undefined): number {
  const value = raw?.trim() ?? "";
  if (!value) return PAYMENT_LEDGER_DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) {
    throw new PaymentLedgerInputError(
      `limit 需为 1-${PAYMENT_LEDGER_MAX_LIMIT} 的整数`,
    );
  }
  const limit = Number(value);
  if (limit < 1 || limit > PAYMENT_LEDGER_MAX_LIMIT) {
    throw new PaymentLedgerInputError(
      `limit 需为 1-${PAYMENT_LEDGER_MAX_LIMIT} 的整数`,
    );
  }
  return limit;
}

/** 金额一律输出**十进制字符串分**（仓库约定：禁止把分变成 number）。 */
export function toLedgerRowView(row: PaymentLedgerRow): PaymentLedgerRowView {
  const refundableFen =
    row.amountFen > row.refundedFen ? row.amountFen - row.refundedFen : 0n;
  return {
    id: row.id,
    outNo: row.outNo,
    amountFen: row.amountFen.toString(),
    refundedFen: row.refundedFen.toString(),
    refundableFen: refundableFen.toString(),
    canRefund: row.status === "SUCCESS" && refundableFen > 0n,
    status: row.status,
    customerProfileId: row.customerProfileId,
    customerName: row.customerName,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
  };
}
