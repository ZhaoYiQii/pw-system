import type {
  TenantWalletDetail,
  TenantWalletRepository,
  TenantWalletRow,
  WalletEntryRow,
} from "./tenant-wallet-ports.js";
import { parseLedgerLimit } from "./payment-ledger.service.js";
import {
  PaymentLedgerInputError,
  PaymentWalletNotFoundError,
} from "../domain/payments.errors.js";

/**
 * S4-9a：门店客户钱包台账（余额列表 + 单个客户的充值/退款流水）。
 *
 * 口径：
 * - **只读**：门店看得到、不动余额；充值由客户在 H5 走支付，退款走人工退款登记（已扣钱包）；
 * - 金额一律十进制字符串分；流水方向由**写流水的那一方**（S4-2 入账 / S4-4 退款 / 结算扣费）定的 type 决定：
 *   `RECHARGE` 入账、`REFUND` 出账、`DEDUCT` 出账；**认不出的 type 一律不给方向**（不猜正负），
 *   只把原值透出，避免把门店账目显示成相反的方向；
 * - 上游 limit 只作用于流水条数；列表 limit 与支付台账共用同一处校验（认不出就 400，不静默夹取）。
 */

export const WALLET_LIST_LIMIT_DEFAULT = 50;
export const WALLET_ENTRY_LIMIT_DEFAULT = 50;
/** 客户名搜索串上限：再长只会是误粘贴，直接 400 比静默截断好。 */
export const WALLET_QUERY_MAX_LENGTH = 50;

/** 流水类型 → 中文说明（三个取值分别来自 S4-2 入账、S4-4 退款、结算扣费三处写入方）。 */
export const WALLET_ENTRY_TYPE_LABEL: Record<string, string> = {
  RECHARGE: "充值 / 支付入账",
  REFUND: "退款出账",
  DEDUCT: "订单结算扣费",
};

/** 流水方向：IN = 余额增加，OUT = 余额减少。认不出的类型返回 null（前端不带符号显示原值）。 */
export const WALLET_ENTRY_DIRECTION: Record<string, "IN" | "OUT"> = {
  RECHARGE: "IN",
  REFUND: "OUT",
  DEDUCT: "OUT",
};

export interface TenantWalletView {
  walletId: string;
  bossNo: string;
  customerProfileId: string;
  customerName: string | null;
  balanceFen: string;
  entryCount: number;
  lastEntryAt: string | null;
}

export interface WalletEntryView {
  id: string;
  txNo: string;
  type: string;
  typeLabel: string;
  direction: "IN" | "OUT" | null;
  amountFen: string;
  balanceAfterFen: string;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface TenantWalletDetailView {
  walletId: string;
  bossNo: string;
  customerProfileId: string;
  customerName: string | null;
  balanceFen: string;
  entries: WalletEntryView[];
}

export class TenantWalletService {
  constructor(private readonly repository: TenantWalletRepository) {}

  async listWallets(input: {
    tenantId: string;
    query?: string;
    limit?: string;
  }): Promise<{
    rows: TenantWalletView[];
    limit: number;
    query: string | null;
  }> {
    const limit = parseLedgerLimit(input.limit);
    const query = parseWalletQuery(input.query);
    const rows = await this.repository.listWallets({
      tenantId: input.tenantId,
      ...(query ? { query } : {}),
      limit,
    });
    return { rows: rows.map(toWalletView), limit, query };
  }

  async getWalletDetail(input: {
    tenantId: string;
    customerProfileId: string;
    limit?: string;
  }): Promise<TenantWalletDetailView> {
    const entryLimit = input.limit
      ? parseLedgerLimit(input.limit)
      : WALLET_ENTRY_LIMIT_DEFAULT;
    const detail = await this.repository.findWalletDetail({
      tenantId: input.tenantId,
      customerProfileId: input.customerProfileId,
      entryLimit,
    });
    if (!detail) {
      throw new PaymentWalletNotFoundError(
        "该客户没有钱包记录：客户还没有充过值",
      );
    }
    return toWalletDetailView(detail);
  }
}

export function parseWalletQuery(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (value.length > WALLET_QUERY_MAX_LENGTH) {
    throw new PaymentLedgerInputError(
      `查询串最多 ${WALLET_QUERY_MAX_LENGTH} 个字符`,
    );
  }
  return value;
}

export function walletEntryTypeLabel(type: string): string {
  return WALLET_ENTRY_TYPE_LABEL[type] ?? `未识别类型：${type}`;
}

export function toWalletView(row: TenantWalletRow): TenantWalletView {
  return {
    walletId: row.walletId,
    bossNo: row.bossNo,
    customerProfileId: row.customerProfileId,
    customerName: row.customerName,
    balanceFen: row.balanceFen.toString(),
    entryCount: row.entryCount,
    lastEntryAt: row.lastEntryAt?.toISOString() ?? null,
  };
}

export function toWalletEntryView(row: WalletEntryRow): WalletEntryView {
  return {
    id: row.id,
    txNo: row.txNo,
    type: row.type,
    typeLabel: walletEntryTypeLabel(row.type),
    direction: WALLET_ENTRY_DIRECTION[row.type] ?? null,
    amountFen: row.amountFen.toString(),
    balanceAfterFen: row.balanceAfterFen.toString(),
    reason: row.reason,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWalletDetailView(
  detail: TenantWalletDetail,
): TenantWalletDetailView {
  return {
    walletId: detail.walletId,
    bossNo: detail.bossNo,
    customerProfileId: detail.customerProfileId,
    customerName: detail.customerName,
    balanceFen: detail.balanceFen.toString(),
    entries: detail.entries.map(toWalletEntryView),
  };
}
