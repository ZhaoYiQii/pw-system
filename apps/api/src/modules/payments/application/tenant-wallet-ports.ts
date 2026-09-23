/**
 * S4-9a：门店**客户钱包台账**的仓储端口（接口隔离，便于单测注入假实现）。
 *
 * 背景：现有 `/api/v1/boss/wallet` 是**客户自己**看钱包用的（要求 `CUSTOMER` 身份），
 * 门店侧看不到"哪个客户充了多少、还剩多少"。门店对账要能自己查，否则只能从支付台账倒推。
 */

export interface TenantWalletRow {
  walletId: string;
  bossNo: string;
  customerProfileId: string;
  customerName: string | null;
  balanceFen: bigint;
  entryCount: number;
  lastEntryAt: Date | null;
}

export interface TenantWalletQuery {
  tenantId: string;
  /** 客户名包含匹配（大小写不敏感）；undefined = 不过滤。 */
  query?: string;
  limit: number;
}

export interface WalletEntryRow {
  id: string;
  txNo: string;
  type: string;
  amountFen: bigint;
  balanceAfterFen: bigint;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
}

export interface TenantWalletDetail {
  walletId: string;
  bossNo: string;
  customerProfileId: string;
  customerName: string | null;
  balanceFen: bigint;
  entries: WalletEntryRow[];
}

export interface TenantWalletRepository {
  /** 最近有变动的钱包在前；`query` 只过滤客户名，不过滤余额。 */
  listWallets(query: TenantWalletQuery): Promise<TenantWalletRow[]>;
  /** 按客户档案查钱包与最近流水；客户没有钱包时返回 null（服务层翻译成 404）。 */
  findWalletDetail(input: {
    tenantId: string;
    customerProfileId: string;
    entryLimit: number;
  }): Promise<TenantWalletDetail | null>;
}
